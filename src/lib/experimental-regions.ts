// Experimental geographic regions — not state-bounded.
// Polygons are approximate (lon, lat) rings tracing the user's reference image
// plus a few extra commonly-used severe-weather regions.

import { pointInRing } from "./dat";

export interface ExpRegion {
  name: string;
  color: string;       // legend tint
  poly: [number, number][]; // [lon, lat]
}

// Helper: rectangle (W,S,E,N) → polygon
const box = (w: number, s: number, e: number, n: number): [number, number][] => [
  [w, s], [e, s], [e, n], [w, n], [w, s],
];

// Tightened polygons that better match a storm-chaser POV: focused on the
// classic chase corridors rather than full geographic extents.
export const EXPERIMENTAL_REGIONS: ExpRegion[] = [
  {
    name: "Northern Plains",
    color: "#ff5a2c",
    poly: [
      [-104.0, 49.0], [-96.5, 49.0], [-96.5, 45.5], [-99.0, 44.0],
      [-104.0, 44.0], [-104.0, 49.0],
    ],
  },
  {
    name: "Central Plains (chase alley)",
    color: "#7ec8ff",
    poly: [
      [-103.0, 43.0], [-96.0, 43.0], [-96.0, 38.0], [-97.5, 36.5],
      [-103.0, 36.5], [-103.0, 43.0],
    ],
  },
  {
    name: "Southern Plains (Red River)",
    color: "#e02323",
    poly: [
      [-103.0, 36.5], [-96.5, 36.5], [-96.0, 33.5], [-99.0, 32.0],
      [-103.0, 32.0], [-103.0, 36.5],
    ],
  },
  {
    name: "Texas Hill Country",
    color: "#ff8a1f",
    poly: [
      [-101.0, 31.5], [-97.5, 31.5], [-96.5, 29.5], [-99.0, 28.5],
      [-101.5, 29.5], [-101.0, 31.5],
    ],
  },
  {
    name: "Dixie Alley",
    color: "#a020f0",
    poly: [
      [-94.5, 35.5], [-86.0, 35.5], [-85.5, 32.0], [-89.0, 30.5],
      [-94.0, 30.5], [-94.5, 35.5],
    ],
  },
  {
    name: "Mid-South / Mississippi Valley",
    color: "#22d3ee",
    poly: [
      [-93.0, 36.5], [-88.0, 36.5], [-88.0, 33.0], [-92.5, 32.5],
      [-93.0, 36.5],
    ],
  },
  {
    name: "Tennessee Valley",
    color: "#34d399",
    poly: [
      [-88.5, 36.5], [-83.5, 36.5], [-83.5, 34.0], [-88.5, 34.0],
      [-88.5, 36.5],
    ],
  },
  {
    name: "Ozarks",
    color: "#f472b6",
    poly: [
      [-94.5, 38.0], [-90.0, 38.0], [-89.5, 35.5], [-94.5, 35.5],
      [-94.5, 38.0],
    ],
  },
  {
    name: "Ohio River Valley",
    color: "#1f6feb",
    poly: [
      [-88.5, 41.0], [-81.5, 41.0], [-80.5, 38.0], [-83.5, 36.5],
      [-87.5, 37.0], [-88.5, 38.5], [-88.5, 41.0],
    ],
  },
  {
    name: "Corn Belt (IA / IL / IN)",
    color: "#a78bfa",
    poly: [
      [-96.0, 43.5], [-86.5, 43.5], [-86.5, 39.5], [-91.0, 39.0],
      [-96.0, 40.5], [-96.0, 43.5],
    ],
  },
  {
    name: "Upper Midwest (MN / WI)",
    color: "#818cf8",
    poly: [
      [-96.5, 49.0], [-87.0, 47.5], [-87.0, 43.5], [-93.0, 43.0],
      [-96.5, 45.5], [-96.5, 49.0],
    ],
  },
  {
    name: "Carolinas",
    color: "#ffd23a",
    poly: [
      [-84.0, 36.5], [-75.5, 36.5], [-75.5, 33.5], [-81.0, 32.0],
      [-84.0, 34.5], [-84.0, 36.5],
    ],
  },
];

export function regionByName(name: string): ExpRegion | undefined {
  return EXPERIMENTAL_REGIONS.find((r) => r.name === name);
}

export function pointInRegion(lat: number, lon: number, region: ExpRegion): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return pointInRing(lon, lat, region.poly as unknown as number[][]);
}
