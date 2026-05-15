import { useEffect, useState, useCallback, useRef } from "react";
import type { WarningKind } from "@/lib/warnings";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";

export type Basemap =
  | "carto-dark"
  | "carto-light"
  | "carto-voyager"
  | "esri-imagery";

export const BASEMAP_OPTIONS: { key: Basemap; label: string; url: string; attr: string; subdomains?: string }[] = [
  { key: "carto-dark", label: "Carto Dark (default)", url: "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png", attr: "&copy; CARTO &copy; OpenStreetMap" },
  { key: "carto-light", label: "Carto Light", url: "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", attr: "&copy; CARTO &copy; OpenStreetMap" },
  { key: "carto-voyager", label: "Carto Voyager", url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png", attr: "&copy; CARTO &copy; OpenStreetMap" },
  { key: "esri-imagery", label: "Esri Satellite", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attr: "Tiles &copy; Esri" },
];

const VALID_BASEMAPS = new Set<Basemap>(["carto-dark", "carto-light", "carto-voyager", "esri-imagery"]);
const BASEMAP_MIGRATIONS: Record<string, Basemap> = {
  "carto-darkmatter-nolabels": "carto-dark",
  "carto-positron-nolabels": "carto-light",
  "carto-voyager-nolabels": "carto-voyager",
  "osm": "carto-light",
  "esri-topo": "carto-light",
  "stamen-terrain": "carto-light",
};
function migrateBasemap(v: any): Basemap {
  if (typeof v === "string" && VALID_BASEMAPS.has(v as Basemap)) return v as Basemap;
  if (typeof v === "string" && BASEMAP_MIGRATIONS[v]) return BASEMAP_MIGRATIONS[v];
  return "carto-dark";
}

export interface LineStyle { enabled: boolean; color: string; weight: number; dashed?: boolean; }
export interface WarnStyle { color: string; weight: number; fillOpacity: number; }
export interface SigEntry { color: string; weight: number; }
export type SigKey = "SIG" | "CIG1" | "CIG2" | "CIG3";
export interface SpcStyle { weight: number; fillOpacity: number; strokeOpacity: number; sig: Record<SigKey, SigEntry>; }
export type TimeZonePref = "local" | "utc";
export type ThemeMode = "dark" | "light";

export interface LabelStyle {
  enabled: boolean;
  fontSize: number;       // px
  color: string;          // hex
  outlineColor: string;   // hex
  outlineWidth: number;   // px (0 = no outline)
}
export interface CityLabelStyle extends LabelStyle {
  density: 1 | 2 | 3 | 4 | 5; // 1 = major only, 5 = all
}

export interface AppSettings {
  basemap: Basemap;
  timeZone: TimeZonePref;
  theme: ThemeMode;
  warnings: Record<WarningKind, WarnStyle>;
  spc: SpcStyle;
  states: LineStyle;
  counties: LineStyle & { dashed: boolean };
  countries: LineStyle;
  wfo: LineStyle;
  cityLabels: CityLabelStyle;
  stateLabels: LabelStyle;
}

let _tzPref: TimeZonePref = "local";
export function setTimeZonePref(tz: TimeZonePref) { _tzPref = tz; }
export function getTimeZonePref(): TimeZonePref { return _tzPref; }
export function tzOptions(): Intl.DateTimeFormatOptions { return _tzPref === "utc" ? { timeZone: "UTC" } : {}; }
export function tzSuffix(): string { return _tzPref === "utc" ? " UTC" : ""; }

export const DEFAULT_SETTINGS: AppSettings = {
  basemap: "carto-dark",
  timeZone: "local",
  theme: "dark",
  warnings: {
    svr:      { color: "#ffd23a", weight: 1.4, fillOpacity: 0.18 },
    destrSvr: { color: "#ff8c00", weight: 1.6, fillOpacity: 0.22 },
    tor:      { color: "#ff0000", weight: 1.8, fillOpacity: 0.22 },
    pdsTor:   { color: "#9400d3", weight: 2.0, fillOpacity: 0.28 },
    torE:     { color: "#ff69b4", weight: 2.2, fillOpacity: 0.32 },
  },
  spc: {
    weight: 2.0, fillOpacity: 0.45, strokeOpacity: 1.0,
    sig: {
      SIG:  { color: "#000000", weight: 1.0 },
      CIG1: { color: "#000000", weight: 1.0 },
      CIG2: { color: "#000000", weight: 1.6 },
      CIG3: { color: "#000000", weight: 2.2 },
    },
  },
  states:    { enabled: true,  color: "#9aa3ad", weight: 1.0 },
  counties:  { enabled: false, color: "#6b7480", weight: 0.6, dashed: true },
  countries: { enabled: true,  color: "#cdd3da", weight: 1.4 },
  wfo:       { enabled: false, color: "#5cb8ff", weight: 1.2 },
  cityLabels: {
    enabled: false, density: 3, fontSize: 11,
    color: "#ffffff", outlineColor: "#000000", outlineWidth: 2,
  },
  stateLabels: {
    enabled: false, fontSize: 14,
    color: "#ffffff", outlineColor: "#000000", outlineWidth: 3,
  },
};

const KEY = "dat-viewer-settings";
const LEGACY_KEYS = ["dat-viewer-settings-v2", "dat-viewer-settings-v1"];

const isHex = (v: unknown) => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
const num = (v: unknown, fallback: number, min: number, max: number) => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
};

function sanitizeLabel<T extends LabelStyle>(s: any, fb: T): T {
  return {
    ...fb,
    enabled: !!s?.enabled,
    fontSize: num(s?.fontSize, fb.fontSize, 6, 48),
    color: isHex(s?.color) ? s.color : fb.color,
    outlineColor: isHex(s?.outlineColor) ? s.outlineColor : fb.outlineColor,
    outlineWidth: num(s?.outlineWidth, fb.outlineWidth, 0, 8),
  };
}

function sanitizeSettings(s: AppSettings): AppSettings {
  const cleanWarn = Object.fromEntries(
    Object.entries(DEFAULT_SETTINGS.warnings).map(([k, fallback]) => {
      const current = s.warnings[k as WarningKind] ?? fallback;
      return [k, {
        color: isHex(current.color) ? current.color : fallback.color,
        weight: num(current.weight, fallback.weight, 0, 6),
        fillOpacity: num(current.fillOpacity, fallback.fillOpacity, 0, 1),
      }];
    })
  ) as AppSettings["warnings"];
  const cityFb = DEFAULT_SETTINGS.cityLabels;
  const cityRaw: any = s.cityLabels ?? {};
  return {
    ...s,
    basemap: migrateBasemap((s as any).basemap),
    timeZone: s.timeZone === "utc" ? "utc" : "local",
    theme: s.theme === "light" ? "light" : "dark",
    warnings: cleanWarn,
    spc: {
      weight: num(s.spc.weight, DEFAULT_SETTINGS.spc.weight, 0, 6),
      fillOpacity: num(s.spc.fillOpacity, DEFAULT_SETTINGS.spc.fillOpacity, 0, 1),
      strokeOpacity: num(s.spc.strokeOpacity, DEFAULT_SETTINGS.spc.strokeOpacity, 0, 1),
      sig: (() => {
        const sp = s.spc as any;
        const legacyColor = sp.sigColor ?? sp.sigHatchColor ?? sp.sigBorderColor;
        const legacyWeight = sp.sigWeight ?? sp.sigBorderWeight;
        const out = {} as Record<string, SigEntry>;
        for (const k of ["SIG", "CIG1", "CIG2", "CIG3"] as SigKey[]) {
          const cur = sp.sig?.[k];
          const fb = DEFAULT_SETTINGS.spc.sig[k];
          out[k] = {
            color: isHex(cur?.color) ? cur.color : (isHex(legacyColor) ? legacyColor : fb.color),
            weight: num(cur?.weight ?? legacyWeight, fb.weight, 0, 6),
          };
        }
        return out as Record<SigKey, SigEntry>;
      })(),
    },
    cityLabels: {
      ...sanitizeLabel(cityRaw, cityFb),
      density: (() => {
        const d = Math.round(num(cityRaw.density, cityFb.density, 1, 5));
        return d as 1 | 2 | 3 | 4 | 5;
      })(),
    },
    stateLabels: sanitizeLabel(s.stateLabels, DEFAULT_SETTINGS.stateLabels),
  };
}

function mergeWithDefaults(parsed: any): AppSettings {
  return sanitizeSettings({
    ...DEFAULT_SETTINGS,
    ...parsed,
    warnings: { ...DEFAULT_SETTINGS.warnings, ...(parsed?.warnings ?? {}) },
    spc: { ...DEFAULT_SETTINGS.spc, ...(parsed?.spc ?? {}) },
    states: { ...DEFAULT_SETTINGS.states, ...(parsed?.states ?? {}) },
    counties: { ...DEFAULT_SETTINGS.counties, ...(parsed?.counties ?? {}) },
    countries: { ...DEFAULT_SETTINGS.countries, ...(parsed?.countries ?? {}) },
    wfo: { ...DEFAULT_SETTINGS.wfo, ...(parsed?.wfo ?? {}) },
    cityLabels: { ...DEFAULT_SETTINGS.cityLabels, ...(parsed?.cityLabels ?? {}) },
    stateLabels: { ...DEFAULT_SETTINGS.stateLabels, ...(parsed?.stateLabels ?? {}) },
  });
}

function loadLocal(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY) ?? LEGACY_KEYS.map((k) => window.localStorage.getItem(k)).find(Boolean);
    if (!raw) return DEFAULT_SETTINGS;
    return mergeWithDefaults(JSON.parse(raw));
  } catch { return DEFAULT_SETTINGS; }
}

function applyTheme(theme: ThemeMode) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  if (theme === "light") { el.classList.add("light"); el.classList.remove("dark"); }
  else { el.classList.add("dark"); el.classList.remove("light"); }
}

export function useAppSettings() {
  const [settings, setSettingsState] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const lastSerializedRef = useRef<string>("");
  const skipNextSyncRef = useRef(true); // skip initial write to localStorage AND cloud

  // Hydrate from localStorage on mount, then watch auth
  useEffect(() => {
    const local = loadLocal();
    skipNextSyncRef.current = true;
    lastSerializedRef.current = JSON.stringify(local);
    setSettingsState(local);
    setTimeZonePref(local.timeZone);
    applyTheme(local.theme);
    setHydrated(true);

    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    return () => { sub.subscription.unsubscribe(); };
  }, []);

  // When session appears, pull cloud settings (or push local up if none exist).
  useEffect(() => {
    if (!hydrated || !session?.user) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("user_settings")
        .select("settings")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) { console.warn("settings sync: load failed", error.message); return; }
      if (data?.settings) {
        const merged = mergeWithDefaults(data.settings);
        skipNextSyncRef.current = true; // remote->local should not trigger a push back
        lastSerializedRef.current = JSON.stringify(merged);
        setSettingsState(merged);
        setTimeZonePref(merged.timeZone);
        applyTheme(merged.theme);
        try { window.localStorage.setItem(KEY, JSON.stringify(merged)); } catch {}
      } else {
        // No cloud row yet; push current local up so user's existing prefs become the seed.
        const payload = loadLocal();
        await supabase.from("user_settings").upsert({ user_id: session.user.id, settings: payload as any });
      }
    })();
    return () => { cancelled = true; };
  }, [hydrated, session?.user?.id]);

  // Keep timezone formatter in sync
  useEffect(() => { setTimeZonePref(settings.timeZone); }, [settings.timeZone]);
  useEffect(() => { applyTheme(settings.theme); }, [settings.theme]);

  // Persist locally + (debounced) to cloud
  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    const serialized = JSON.stringify(settings);
    if (serialized === lastSerializedRef.current) return;
    lastSerializedRef.current = serialized;
    if (skipNextSyncRef.current) { skipNextSyncRef.current = false; return; }

    try { window.localStorage.setItem(KEY, serialized); } catch {}

    if (!session?.user) return;
    const userId = session.user.id;
    const handle = window.setTimeout(() => {
      supabase
        .from("user_settings")
        .upsert({ user_id: userId, settings: JSON.parse(serialized) })
        .then(({ error }) => { if (error) console.warn("settings sync: save failed", error.message); });
    }, 600);
    return () => window.clearTimeout(handle);
  }, [settings, hydrated, session?.user?.id]);

  const setSettings = useCallback((s: AppSettings) => setSettingsState(s), []);
  const reset = useCallback(() => setSettingsState(DEFAULT_SETTINGS), []);

  return { settings, setSettings, reset, session };
}
