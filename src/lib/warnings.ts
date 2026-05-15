// NWS Storm-Based Warnings via the Iowa State IEM archive.
// Endpoint returns a GeoJSON FeatureCollection of polygon warnings.
// https://mesonet.agron.iastate.edu/geojson/sbw.geojson?sts=...&ets=...

export type WarningKind =
  | "svr"        // Severe Thunderstorm Warning (regular)
  | "destrSvr"   // Destructive-tagged Severe Thunderstorm
  | "tor"        // Tornado Warning
  | "pdsTor"     // PDS Tornado Warning
  | "torE";      // Tornado Emergency

export interface WarningFeature {
  id: string;
  kind: WarningKind;
  issued: number;
  expires: number;
  wfo: string | null;
  geometry: any; // GeoJSON Polygon / MultiPolygon
  raw: any;      // properties
}

export const WARNING_COLORS: Record<WarningKind, string> = {
  svr:      "#ffd23a", // NWS yellow
  destrSvr: "#ff8c00", // distinguishable orange
  tor:      "#ff0000", // NWS red
  pdsTor:   "#9400d3", // purple
  torE:     "#ff69b4", // pink
};

export const WARNING_LABELS: Record<WarningKind, string> = {
  svr:      "Severe Thunderstorm Warning",
  destrSvr: "Destructive Severe T-Storm",
  tor:      "Tornado Warning",
  pdsTor:   "PDS Tornado Warning",
  torE:     "Tornado Emergency",
};

function fmt(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

function classify(props: any): WarningKind | null {
  const phenom = (props?.phenomena ?? props?.ph ?? "").toString().toUpperCase();
  const sig = (props?.significance ?? props?.sig ?? "W").toString().toUpperCase();
  if (sig !== "W") return null;
  const tornEmer = (props?.tornadoemergency ?? props?.is_emergency ?? "").toString().toLowerCase();
  const isPDS = (props?.pds ?? props?.is_pds ?? "").toString().toLowerCase() === "true";
  const damageThreat = (props?.damagetag ?? props?.damage_threat ?? props?.dt ?? "").toString().toUpperCase();
  if (phenom === "TO") {
    if (tornEmer === "true" || tornEmer === "1") return "torE";
    if (isPDS) return "pdsTor";
    return "tor";
  }
  if (phenom === "SV") {
    if (damageThreat === "DESTRUCTIVE") return "destrSvr";
    return "svr";
  }
  return null;
}

function parseTs(v: any): number {
  if (!v) return 0;
  if (typeof v === "number") return v;
  return new Date(v).getTime() || 0;
}

const MAX_DAYS = 365;
const CHUNK_DAYS = 30; // Fetch in monthly chunks to keep each request small

export interface FetchWarningsResult {
  features: WarningFeature[];
  truncated: boolean;
  capped: boolean;
}

async function fetchChunk(s: number, e: number, signal?: AbortSignal): Promise<WarningFeature[]> {
  const url = `https://mesonet.agron.iastate.edu/geojson/sbw.geojson?sts=${fmt(s)}&ets=${fmt(e)}`;
  const res = await fetch(url, { signal, cache: "force-cache" });
  if (!res.ok) throw new Error(`Warnings fetch failed: ${res.status}`);
  const gj = await res.json();
  const out: WarningFeature[] = [];
  for (const f of gj.features ?? []) {
    const kind = classify(f.properties ?? {});
    if (!kind) continue;
    out.push({
      id: f.id ?? `${f.properties?.eventid ?? Math.random()}`,
      kind,
      issued: parseTs(f.properties?.issue ?? f.properties?.issued),
      expires: parseTs(f.properties?.expire ?? f.properties?.expires),
      wfo: f.properties?.wfo ?? null,
      geometry: f.geometry,
      raw: f.properties,
    });
  }
  return out;
}

export async function fetchWarnings(
  startMs: number,
  endMs: number,
  signal?: AbortSignal
): Promise<FetchWarningsResult> {
  const days = (endMs - startMs) / 86400000;
  let capped = false;
  let s = startMs;
  if (days > MAX_DAYS) {
    s = endMs - MAX_DAYS * 86400000;
    capped = true;
  }

  // Build chunk windows so each fetch is small/cacheable
  const windows: Array<[number, number]> = [];
  const chunkMs = CHUNK_DAYS * 86400000;
  for (let cs = s; cs < endMs; cs += chunkMs) {
    windows.push([cs, Math.min(cs + chunkMs, endMs)]);
  }

  // Run with limited concurrency to avoid overwhelming the endpoint
  const all: WarningFeature[] = [];
  const CONCURRENCY = 4;
  let idx = 0;
  async function worker() {
    while (idx < windows.length) {
      const i = idx++;
      const [a, b] = windows[i];
      const part = await fetchChunk(a, b, signal);
      all.push(...part);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, windows.length) }, worker));

  // Dedupe by id (chunks can overlap on edges)
  const byId = new Map<string, WarningFeature>();
  for (const w of all) byId.set(w.id, w);

  return { features: [...byId.values()], truncated: false, capped };
}
