import { tzOptions, tzSuffix } from "@/lib/settings";
// NWS Damage Assessment Toolkit — public ArcGIS Feature Service
export const DAT_BASE =
  "https://services.dat.noaa.gov/arcgis/rest/services/nws_damageassessmenttoolkit/DamageViewer/FeatureServer";
const BASE = DAT_BASE;

export interface DatAttachment {
  id: number;
  name: string;
  contentType: string;
  url: string;
}

const _attachCache = new Map<number, Promise<DatAttachment[]>>();

/** Lazy-fetch ArcGIS attachments (photos) for a damage point objectid. */
export function fetchDamagePointAttachments(objectid: number): Promise<DatAttachment[]> {
  const cached = _attachCache.get(objectid);
  if (cached) return cached;
  const p = (async () => {
    try {
      const res = await fetch(
        `${BASE}/0/queryAttachments?objectIds=${objectid}&f=json`,
        { cache: "force-cache" }
      );
      if (!res.ok) return [];
      const data = await res.json();
      const groups = data.attachmentGroups ?? [];
      const out: DatAttachment[] = [];
      for (const g of groups) {
        for (const a of g.attachmentInfos ?? []) {
          out.push({
            id: a.id,
            name: a.name,
            contentType: a.contentType,
            url: `${BASE}/0/${objectid}/attachments/${a.id}`,
          });
        }
      }
      // Dedupe by name (keep largest)
      const byName = new Map<string, DatAttachment>();
      for (const a of out) if (!byName.has(a.name)) byName.set(a.name, a);
      return [...byName.values()];
    } catch {
      return [];
    }
  })();
  _attachCache.set(objectid, p);
  return p;
}

export type EFScale = "NA" | "TSTM" | "EFU" | "EF0" | "EF1" | "EF2" | "EF3" | "EF4" | "EF5";

export interface DamagePoint {
  objectid: number;
  stormdate: number | null;
  surveydate: number | null;
  event_id: string | null;
  damage_txt: string | null;
  dod_txt: string | null;
  efscale: EFScale | string | null;
  windspeed: string | null;
  injuries: number | null;
  deaths: number | null;
  lat: number;
  lon: number;
  office: string | null;
  image: string | null;
  comments: string | null;
  state?: string;
}

export interface DamageLine {
  objectid: number;
  event_id: string | null;
  stormdate: number | null;
  starttime: number | null;
  endtime: number | null;
  startlat: number;
  startlon: number;
  endlat: number;
  endlon: number;
  length: number | null;
  width: number | null;
  injuries: number | null;
  fatalities: number | null;
  efscale: EFScale | string | null;
  efnum: number | null;
  maxwind: number | null;
  wfo: string | null;
  comments: string | null;
  state?: string;
  paths: [number, number][][]; // [ring][point] = [lat, lon]
}

export interface DatResult {
  points: DamagePoint[];
  lines: DamageLine[];
  pointsExceeded: boolean;
  linesExceeded: boolean;
  fetchedAt: number;
}

function arcgisDate(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(
    d.getUTCDate()
  )} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

async function queryLayer(
  layer: 0 | 1,
  startMs: number,
  endMs: number,
  signal?: AbortSignal
) {
  const where = encodeURIComponent(
    `stormdate >= timestamp '${arcgisDate(startMs)}' AND stormdate <= timestamp '${arcgisDate(endMs)}'`
  );
  const url =
    `${BASE}/${layer}/query?where=${where}&outFields=*` +
    `&f=json&resultRecordCount=2000&orderByFields=stormdate+DESC` +
    `&returnGeometry=true&outSR=4326`;

  const allFeatures: any[] = [];
  let offset = 0;
  let exceeded = false;
  for (let i = 0; i < 25; i++) {
    const res = await fetch(`${url}&resultOffset=${offset}&_=${Date.now()}`, {
      cache: "no-store",
      signal,
    });
    if (!res.ok) throw new Error(`DAT layer ${layer} failed: ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message ?? "DAT query error");
    const feats = data.features ?? [];
    allFeatures.push(...feats);
    exceeded = !!data.exceededTransferLimit;
    if (!exceeded || feats.length === 0) break;
    offset += feats.length;
  }
  return { features: allFeatures, exceededTransferLimit: exceeded };
}

export async function fetchDamage(
  startMs: number,
  endMs: number,
  signal?: AbortSignal
): Promise<DatResult> {
  const states = await loadStates();
  const [pData, lData] = await Promise.all([
    queryLayer(0, startMs, endMs, signal),
    queryLayer(1, startMs, endMs, signal),
  ]);

  const points: DamagePoint[] = (pData.features ?? []).map((f: any) => {
    const lat = f.geometry?.y ?? f.attributes?.lat;
    const lon = f.geometry?.x ?? f.attributes?.lon;
    return {
      ...f.attributes,
      lat,
      lon,
      state: stateForPoint(states, lat, lon),
    };
  });

  const lines: DamageLine[] = (lData.features ?? []).map((f: any) => {
    const a = f.attributes;
    const rawPaths: number[][][] = f.geometry?.paths ?? [];
    const paths: [number, number][][] = rawPaths.map((ring) =>
      ring.map(([x, y]) => [y, x] as [number, number])
    );
    let repLat = (a.startlat + a.endlat) / 2;
    let repLon = (a.startlon + a.endlon) / 2;
    const longest = paths.reduce((b, r) => (r.length > b.length ? r : b), paths[0] ?? []);
    if (longest && longest.length) {
      const mid = longest[Math.floor(longest.length / 2)];
      repLat = mid[0]; repLon = mid[1];
    }
    return { ...a, paths, state: stateForPoint(states, repLat, repLon) };
  });

  return {
    points,
    lines,
    pointsExceeded: !!pData.exceededTransferLimit,
    linesExceeded: !!lData.exceededTransferLimit,
    fetchedAt: Date.now(),
  };
}

// NWS DAT-matching colors
export const EF_COLORS: Record<EFScale, string> = {
  NA:  "#cfd4da", // light gray (no efscale at all)
  TSTM: "#c9f7b8", // light green for TSTM/Wind damage indicators
  EFU: "#5a6168", // dark gray
  EF0: "#7ec8ff", // light blue
  EF1: "#7fe34d", // lime
  EF2: "#ffd23a", // yellow
  EF3: "#ff8a1f", // orange
  EF4: "#e02323", // red
  EF5: "#a020f0", // purple
};

export const EF_ORDER: EFScale[] = ["NA", "TSTM", "EFU", "EF0", "EF1", "EF2", "EF3", "EF4", "EF5"];

export function efOf(p: { efscale: EFScale | string | null }): EFScale {
  const raw = p.efscale;
  if (raw === null || raw === undefined || raw === "") return "NA";
  const v = String(raw).toUpperCase().trim();
  const compact = v.replace(/[^A-Z0-9]+/g, "");
  if (v === "TSTM" || v === "WIND" || compact === "TSTMWIND" || compact === "THUNDERSTORMWIND") return "TSTM";
  if (v === "NA" || v === "N/A") return "NA";
  if (v === "EFU" || v === "U" || v === "UNKNOWN") return "EFU";
  if (["EF0", "EF1", "EF2", "EF3", "EF4", "EF5"].includes(v)) return v as EFScale;
  // numeric like "0".."5"
  if (/^[0-5]$/.test(v)) return ("EF" + v) as EFScale;
  return "EFU";
}



export function fmtDate(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
    ...tzOptions(),
  }) + tzSuffix();
}

export function fmtDateOnly(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    ...tzOptions(),
  });
}

// Default landing range: today → 4 days back
export function defaultRange(): { start: Date; end: Date } {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date();
  start.setDate(start.getDate() - 4);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

// ============= US States (point-in-polygon) =============

type Ring = number[][];
type StatePolys = { name: string; polys: Ring[][] };
let statesCache: StatePolys[] | null = null;
let statesPromise: Promise<StatePolys[]> | null = null;

async function loadStates(): Promise<StatePolys[]> {
  if (statesCache) return statesCache;
  if (statesPromise) return statesPromise;
  statesPromise = (async () => {
    const res = await fetch(
      "https://cdn.jsdelivr.net/gh/PublicaMundi/MappingAPI@master/data/geojson/us-states.json"
    );
    const gj = await res.json();
    const out: StatePolys[] = gj.features.map((f: any) => {
      const name = f.properties.name as string;
      const g = f.geometry;
      let polys: Ring[][];
      if (g.type === "Polygon") polys = [g.coordinates];
      else polys = g.coordinates;
      return { name, polys };
    });
    statesCache = out;
    return out;
  })();
  return statesPromise;
}

export function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function stateForPoint(
  states: StatePolys[],
  lat: number,
  lon: number
): string | undefined {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  for (const s of states) {
    for (const poly of s.polys) {
      if (pointInRing(lon, lat, poly[0])) return s.name;
    }
  }
  return undefined;
}

// Updated regions per user request
export const REGIONS: Record<string, string[]> = {
  Northeast: ["Maine", "Vermont", "New Hampshire", "Massachusetts", "Rhode Island", "New York", "Connecticut"],
  Midwest: ["Ohio", "Indiana", "Michigan", "Illinois", "Wisconsin", "Minnesota", "Iowa", "Missouri"],
  "Great Plains": ["North Dakota", "South Dakota", "Nebraska", "Kansas", "Oklahoma", "Texas"],
  "Mid-Atlantic": ["Pennsylvania", "New Jersey", "Delaware", "Maryland", "West Virginia", "Virginia"],
  Southeast: ["South Carolina", "Georgia", "Florida", "Alabama"],
  "Pacific Northwest": ["Washington", "Oregon", "Idaho"],
};

export const ALL_STATES: string[] = [
  "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut",
  "Delaware","District of Columbia","Florida","Georgia","Hawaii","Idaho","Illinois",
  "Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts",
  "Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada",
  "New Hampshire","New Jersey","New Mexico","New York","North Carolina","North Dakota",
  "Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota",
  "Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia","Wisconsin","Wyoming",
];
