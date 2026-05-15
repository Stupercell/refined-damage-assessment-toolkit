// SPC Day 1 outlook archive — GeoJSON polygons.
// Pattern: https://www.spc.noaa.gov/products/outlook/archive/<YYYY>/day1otlk_<YYYYMMDD>_<HHMM>_<cat|torn>.lyr.geojson

export type OutlookKind = "cat" | "torn";

export const ISSUE_TIMES = ["0100", "0600", "1300", "1630", "2000"] as const;
export type IssueTime = (typeof ISSUE_TIMES)[number];

export const ISSUE_LABEL: Record<IssueTime, string> = {
  "0100": "01z",
  "0600": "06z",
  "1300": "13z",
  "1630": "1630z",
  "2000": "20z",
};

export interface OutlookOption {
  key: string;          // "cat-1300"
  label: string;        // "Categorical (13z)"
  kind: OutlookKind;
  time: IssueTime;
}

export const OUTLOOK_OPTIONS: OutlookOption[] = (["0600", "1300", "1630", "2000", "0100"] as IssueTime[])
  .flatMap((t) => [
    { key: `cat-${t}`,  label: `Categorical (${ISSUE_LABEL[t]})`, kind: "cat" as const,  time: t },
    { key: `torn-${t}`, label: `Tornado (${ISSUE_LABEL[t]})`,     kind: "torn" as const, time: t },
  ]);

// Categorical color table (SPC official RGB values)
export const CAT_COLORS: Record<string, { fill: string; stroke: string; label: string }> = {
  TSTM: { fill: "#c1e9c1", stroke: "#55aa55", label: "General T-Storm" },
  MRGL: { fill: "#66a366", stroke: "#1f6b1f", label: "Marginal" },
  SLGT: { fill: "#f7f04d", stroke: "#b3a800", label: "Slight" },
  ENH:  { fill: "#e6a247", stroke: "#a85a00", label: "Enhanced" },
  MDT:  { fill: "#e84444", stroke: "#a30000", label: "Moderate" },
  HIGH: { fill: "#ff00ff", stroke: "#9b009b", label: "High" },
};

// Tornado probability color table (SPC official RGB values)
export const TORN_COLORS: Record<string, { fill: string; stroke: string; label: string }> = {
  "0.02": { fill: "#008b00", stroke: "#005a00", label: "2%" },
  "0.05": { fill: "#8b4726", stroke: "#5a2e1a", label: "5%" },
  "0.10": { fill: "#ffc800", stroke: "#a88300", label: "10%" },
  "0.15": { fill: "#ff0000", stroke: "#a80000", label: "15%" },
  "0.30": { fill: "#ff00ff", stroke: "#9b009b", label: "30%" },
  "0.45": { fill: "#912cee", stroke: "#5a1a9b", label: "45%" },
  "0.60": { fill: "#104e8b", stroke: "#082a4d", label: "60%" },
};

// Significant tornado threat (legacy "SIG" + new CIG variants)
export const SIG_COLORS: Record<string, { fill: string; stroke: string; label: string; pattern: "diag" | "diag-dashed-opposite" | "cross" | "dots" }> = {
  SIG:  { fill: "#000000", stroke: "#000000", label: "10%+ Significant", pattern: "diag" },
  CIG1: { fill: "#000000", stroke: "#000000", label: "Conditional Sig 1", pattern: "diag" },
  CIG2: { fill: "#000000", stroke: "#000000", label: "Conditional Sig 2 (dashed opposite)", pattern: "diag-dashed-opposite" },
  CIG3: { fill: "#000000", stroke: "#000000", label: "Conditional Sig 3", pattern: "dots" },
};

export interface OutlookFeature {
  label: string;       // category code: TSTM, MRGL, ... or "0.10", "SIG", "CIG1"
  geometry: any;
  isSig: boolean;
}

export interface OutlookResult {
  kind: OutlookKind;
  time: IssueTime;
  date: string;        // YYYYMMDD
  features: OutlookFeature[];
}

function ymd(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function classifyLabel(props: any, kind: OutlookKind): { label: string; isSig: boolean } | null {
  // SPC GeoJSON uses property names like LABEL, LABEL2, DN, VALID, EXPIRE, ...
  const raw = (props?.LABEL ?? props?.label ?? props?.DN ?? "").toString().trim().toUpperCase();
  if (!raw) return null;
  if (kind === "cat") {
    if (["TSTM", "MRGL", "SLGT", "ENH", "MDT", "HIGH"].includes(raw)) {
      return { label: raw, isSig: false };
    }
    return null;
  }
  // tornado
  if (raw === "SIG" || raw.startsWith("CIG")) {
    return { label: raw, isSig: true };
  }
  // probabilities like "0.02".."0.60" or "2", "5", "10"
  if (/^0?\.\d+$/.test(raw)) return { label: raw.replace(/^\./, "0."), isSig: false };
  if (/^\d+%?$/.test(raw)) {
    const n = parseInt(raw, 10) / 100;
    return { label: n.toFixed(2), isSig: false };
  }
  return null;
}

async function tryFetch(url: string, signal?: AbortSignal): Promise<any | null> {
  try {
    const res = await fetch(url, { signal, cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchSpcOutlook(
  date: Date,
  time: IssueTime,
  kind: OutlookKind,
  signal?: AbortSignal
): Promise<OutlookResult> {
  const yyyy = date.getFullYear();
  const dateStr = ymd(date);
  const fileKind = kind === "cat" ? "cat" : "torn";

  // Primary path: archive layered geojson
  const primary = `https://www.spc.noaa.gov/products/outlook/archive/${yyyy}/day1otlk_${dateStr}_${time}_${fileKind}.lyr.geojson`;
  const fallback1 = `https://www.spc.noaa.gov/products/outlook/archive/${yyyy}/day1otlk_${dateStr}_${time}_${fileKind}.nolyr.geojson`;

  let gj = await tryFetch(primary, signal);
  if (!gj) gj = await tryFetch(fallback1, signal);
  if (!gj) {
    throw new Error(
      `SPC outlook not available for ${dateStr} ${time}z. The product may not have been issued, or the archive path differs for that year.`
    );
  }

  const features: OutlookFeature[] = [];
  for (const f of gj.features ?? []) {
    const c = classifyLabel(f.properties ?? {}, kind);
    if (!c) continue;
    features.push({ label: c.label, geometry: f.geometry, isSig: c.isSig });
  }
  return { kind, time, date: dateStr, features };
}

// Whether to show CIG legend (SPC introduced CIG1/2/3 in 2025).
export function useCigLegend(date: Date) {
  return date.getFullYear() >= 2025;
}
