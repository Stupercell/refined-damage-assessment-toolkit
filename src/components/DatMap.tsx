import { useEffect, useRef } from "react";
import L from "leaflet";
import { diff, type Geometry } from "martinez-polygon-clipping";
import {
  type DamagePoint,
  type DamageLine,
  EF_COLORS,
  efOf,
  fmtDate,
  fetchDamagePointAttachments,
} from "@/lib/dat";
import {
  type WarningFeature,
  type WarningKind,
} from "@/lib/warnings";
import {
  CAT_COLORS,
  TORN_COLORS,
  useCigLegend,
  type OutlookResult,
} from "@/lib/spc";
import { triangleMarker } from "@/lib/triangle-marker";
import { type AppSettings, BASEMAP_OPTIONS } from "@/lib/settings";
import { US_STATE_CENTROIDS } from "@/lib/state-centroids";

delete (L.Icon.Default.prototype as any)._getIconUrl;

interface Props {
  points: DamagePoint[];
  lines: DamageLine[];
  showPoints: boolean;
  showLines: boolean;
  warnings: WarningFeature[];
  warningToggles: Record<WarningKind, boolean>;
  outlook: OutlookResult | null;
  outlookDate: Date | null;
  settings: AppSettings;
}

const PANE_COUNTRIES = "pane-countries";
const PANE_STATES = "pane-states";
const PANE_COUNTIES = "pane-counties";
const PANE_WFO = "pane-wfo";
const PANE_SPC = "pane-spc";
const PANE_WARN = "pane-warn";
const PANE_LINES = "pane-lines";
const PANE_LINE_HITS = "pane-line-hits";
const PANE_POINTS = "pane-points";
const PANE_LABELS = "pane-labels";

type LineHitMeta = {
  ln: DamageLine;
  positions: [number, number][][];
  color: string;
  ef: string;
};

export default function DatMap({
  points, lines, showPoints, showLines,
  warnings, warningToggles, outlook, outlookDate, settings,
}: Props) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const lineHitMetaRef = useRef<LineHitMeta[]>([]);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const isTouch = typeof window !== "undefined" && (window.matchMedia("(max-width: 767px)").matches || ("ontouchstart" in window));
    const map = L.map(containerRef.current, {
      center: [39, -96], zoom: 4, worldCopyJump: true, preferCanvas: true,
      zoomControl: !isTouch,
      zoomAnimation: !isTouch,
      markerZoomAnimation: !isTouch,
      fadeAnimation: false,
      // Prevent the map's "click anywhere closes popup" behaviour from racing
      // canvas-renderer marker clicks (which would briefly open then immediately
      // close the popup, especially on touch / high-DPI devices).
      closePopupOnClick: false,
    });

    // Panes (low → high). Labels live on top of everything else.
    map.createPane(PANE_COUNTRIES).style.zIndex = "395";
    map.createPane(PANE_STATES).style.zIndex = "400";
    map.createPane(PANE_COUNTIES).style.zIndex = "405";
    map.createPane(PANE_WFO).style.zIndex = "408";
    map.createPane(PANE_SPC).style.zIndex = "410";
    map.createPane(PANE_WARN).style.zIndex = "430";
    map.createPane(PANE_LINES).style.zIndex = "450";
    const lineHitPane = map.createPane(PANE_LINE_HITS);
    lineHitPane.style.zIndex = "469";
    lineHitPane.style.pointerEvents = "auto";
    map.createPane(PANE_POINTS).style.zIndex = "470";
    const labelsPane = map.createPane(PANE_LABELS);
    labelsPane.style.zIndex = "650";
    labelsPane.style.pointerEvents = "none"; // never steal clicks from features

    // Close any open popup when clicking on empty map area, but ONLY when
    // the click did not originate from a marker / polyline (those stop
    // propagation below). This restores the "click empty area to dismiss"
    // behaviour without the double-fire popup race.
    map.on("click", (e: any) => {
      const target = e.originalEvent?.target as HTMLElement | null;
      const hit = findNearestLineHit(map, lineHitMetaRef.current, e.latlng, isTouch);
      if (hit) {
        openLineDatPopup(map, hit.ln, hit.color, hit.ef, e.latlng);
        return;
      }
      if (target?.closest?.(".leaflet-interactive")) return;
      map.closePopup();
    });

    const invalidate = () => requestAnimationFrame(() => map.invalidateSize({ pan: false }));
    window.addEventListener("resize", invalidate);
    window.addEventListener("focus", invalidate);
    document.addEventListener("visibilitychange", invalidate);
    const resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(invalidate)
      : null;
    if (resizeObserver && containerRef.current) resizeObserver.observe(containerRef.current);
    invalidate();

    mapRef.current = map;
    return () => {
      window.removeEventListener("resize", invalidate);
      window.removeEventListener("focus", invalidate);
      document.removeEventListener("visibilitychange", invalidate);
      resizeObserver?.disconnect();
      map.remove(); mapRef.current = null;
    };
  }, []);

  // Basemap (re-create when changed)
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const opt = BASEMAP_OPTIONS.find((b) => b.key === settings.basemap) ?? BASEMAP_OPTIONS[0];
    if (tileRef.current) { tileRef.current.remove(); tileRef.current = null; }
    tileRef.current = L.tileLayer(opt.url, {
      attribution: opt.attr,
      updateWhenIdle: true,
      updateWhenZooming: false,
      keepBuffer: typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches ? 2 : 3,
      crossOrigin: true,
    }).addTo(map);
  }, [settings.basemap]);

  // Layer groups
  const pointsLayer = useRef<L.LayerGroup | null>(null);
  const linesLayer = useRef<L.LayerGroup | null>(null);
  const warnLayer = useRef<L.LayerGroup | null>(null);
  const spcLayer = useRef<L.LayerGroup | null>(null);
  const countriesLayer = useRef<L.GeoJSON | null>(null);
  const statesLayer = useRef<L.GeoJSON | null>(null);
  const countiesLayer = useRef<L.GeoJSON | null>(null);
  const wfoLayer = useRef<L.GeoJSON | null>(null);
  // Persistent renderers per pane to avoid allocating new <canvas>/svg every render
  const rendLines = useRef<L.Canvas | null>(null);
  const rendLineHits = useRef<L.SVG | null>(null);
  const rendPoints = useRef<L.Canvas | null>(null);
  const rendWarn = useRef<L.Canvas | null>(null);
  const rendCounties = useRef<L.Canvas | null>(null);
  const rendWfo = useRef<L.Canvas | null>(null);
  const rendSpc = useRef<L.SVG | null>(null);

  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    rendLines.current = L.canvas({ padding: 0.5, pane: PANE_LINES }) as any;
    rendLineHits.current = L.svg({ padding: 0.5, pane: PANE_LINE_HITS }) as any;
    rendPoints.current = L.canvas({ padding: 0.5, pane: PANE_POINTS }) as any;
    rendWarn.current = L.canvas({ padding: 0.5, pane: PANE_WARN }) as any;
    rendCounties.current = L.canvas({ padding: 0.5, pane: PANE_COUNTIES }) as any;
    rendWfo.current = L.canvas({ padding: 0.5, pane: PANE_WFO }) as any;
    rendSpc.current = L.svg({ padding: 0.5, pane: PANE_SPC }) as any;
    rendLines.current!.addTo(map);
    rendLineHits.current!.addTo(map);
    rendPoints.current!.addTo(map);
    rendWarn.current!.addTo(map);
    rendCounties.current!.addTo(map);
    rendWfo.current!.addTo(map);
    rendSpc.current!.addTo(map);
    pointsLayer.current = L.layerGroup().addTo(map);
    linesLayer.current = L.layerGroup().addTo(map);
    warnLayer.current = L.layerGroup().addTo(map);
    spcLayer.current = L.layerGroup().addTo(map);
    return () => {
      pointsLayer.current?.remove(); linesLayer.current?.remove();
      warnLayer.current?.remove(); spcLayer.current?.remove();
      countriesLayer.current?.remove(); statesLayer.current?.remove();
      countiesLayer.current?.remove(); wfoLayer.current?.remove();
      rendLines.current?.remove(); rendLineHits.current?.remove(); rendPoints.current?.remove(); rendWarn.current?.remove();
      rendCounties.current?.remove(); rendWfo.current?.remove(); rendSpc.current?.remove();
    };
  }, []);

  // Lines — viewport-culled when many tornado paths are loaded
  useEffect(() => {
    const grp = linesLayer.current; const map = mapRef.current;
    if (!grp || !map) return;
    if (!showLines) { grp.clearLayers(); lineHitMetaRef.current = []; return; }
    const renderer = rendLines.current!;
    const hitRenderer = rendLineHits.current!;

    const lineMeta = lines.map((ln) => {
      const positions: [number, number][][] =
        ln.paths && ln.paths.length
          ? ln.paths
          : [[[ln.startlat, ln.startlon], [ln.endlat, ln.endlon]]];
      let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
      for (const ring of positions) for (const [lat, lon] of ring) {
        if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
        if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
      }
      return { ln, positions, minLat, minLon, maxLat, maxLon };
    });

    const cull = lineMeta.length > 300;

    const render = () => {
      // Don't tear down layers while a popup is open — autoPan triggers
      // moveend, which would otherwise destroy the polyline the popup is
      // anchored to and immediately close the popup.
      if ((map as any)._popup) return;
      grp.clearLayers();
      lineHitMetaRef.current = [];
      const b = cull ? map.getBounds() : null;
      for (const m of lineMeta) {
        if (b) {
          if (m.maxLat < b.getSouth() || m.minLat > b.getNorth() ||
              m.maxLon < b.getWest()  || m.minLon > b.getEast()) continue;
        }
        const ef = efOf(m.ln);
        if (ef === "TSTM") continue;
        const color = EF_COLORS[ef];
        lineHitMetaRef.current.push({ ln: m.ln, positions: m.positions, color, ef });
        const poly = L.polyline(m.positions as any, {
          color, weight: 4, opacity: 0.95,
          lineCap: "round", lineJoin: "round",
          renderer, pane: PANE_LINES,
          bubblingMouseEvents: false,
          interactive: false,
        });
         const hitPoly = L.polyline(m.positions as any, {
           color: "#000000",
           weight: 22,
           opacity: 0.01,
           lineCap: "round",
           lineJoin: "round",
           renderer: hitRenderer,
           pane: PANE_LINE_HITS,
           bubblingMouseEvents: false,
           interactive: true,
           className: "dat-line-hit",
         });
        const ln = m.ln;
        const openLinePopup = (e: any) => {
          if (e.originalEvent) L.DomEvent.stop(e.originalEvent);
          const latLng = e.latlng ?? linePopupLatLng(ln);
          openLineDatPopup(map, ln, color, ef, latLng);
        };
        poly.addTo(grp);
        hitPoly.addTo(grp);
        hitPoly.on("click", openLinePopup);
        hitPoly.on("touchstart", openLinePopup);
        hitPoly.on("mouseover", () => { map.getContainer().style.cursor = "pointer"; });
        hitPoly.on("mouseout", () => { map.getContainer().style.cursor = ""; });
      }
    };

    render();
    const canHover = typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    let cursorRaf: number | null = null;
    const resetCursor = () => { map.getContainer().style.cursor = ""; };
    const onCursorMove = (e: L.LeafletMouseEvent) => {
      if (!canHover || cursorRaf != null) return;
      const latLng = e.latlng;
      cursorRaf = requestAnimationFrame(() => {
        cursorRaf = null;
        const hit = findNearestLineHit(map, lineHitMetaRef.current, latLng, false);
        map.getContainer().style.cursor = hit ? "pointer" : "";
      });
    };
    if (canHover) {
      map.on("mousemove", onCursorMove);
      map.on("mouseout", resetCursor);
    }
    if (!cull) return () => {
      map.off("mousemove", onCursorMove);
      map.off("mouseout", resetCursor);
      if (cursorRaf != null) cancelAnimationFrame(cursorRaf);
      resetCursor();
    };
    let raf: number | null = null;
    const onMove = () => {
      if (raf != null) return;
      raf = requestAnimationFrame(() => { raf = null; render(); });
    };
    map.on("moveend zoomend", onMove);
    return () => {
      map.off("moveend zoomend", onMove);
      map.off("mousemove", onCursorMove);
      map.off("mouseout", resetCursor);
      if (raf != null) cancelAnimationFrame(raf);
      if (cursorRaf != null) cancelAnimationFrame(cursorRaf);
      resetCursor();
    };
  }, [lines, showLines]);

  // Damage points — triangles on canvas (NA = circle).
  // Draw weakest first so EF5/4/3 sit on top of EF0/EFU/NA in canvas.
  // Viewport-culled when many points are loaded.
  useEffect(() => {
    const grp = pointsLayer.current; const map = mapRef.current;
    if (!grp || !map) return;
    if (!showPoints) { grp.clearLayers(); return; }
    const renderer = rendPoints.current!;
    const efRank: Record<string, number> = { NA: 0, TSTM: 1, EFU: 2, EF0: 3, EF1: 4, EF2: 5, EF3: 6, EF4: 7, EF5: 8 };
    const sorted = [...points]
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
      .sort((a, b) => (efRank[efOf(a)] ?? 0) - (efRank[efOf(b)] ?? 0));

    const cull = sorted.length > 800;

    const render = () => {
      if ((map as any)._popup) return;
      grp.clearLayers();
      const b = cull ? map.getBounds() : null;
      const south = b?.getSouth() ?? -Infinity;
      const north = b?.getNorth() ?? Infinity;
      const west  = b?.getWest()  ?? -Infinity;
      const east  = b?.getEast()  ?? Infinity;
      for (const p of sorted) {
        if (b && (p.lat < south || p.lat > north || p.lon < west || p.lon > east)) continue;
        const ef = efOf(p);
        const color = EF_COLORS[ef];
        const baseOpts: L.CircleMarkerOptions = {
          radius: ef === "NA" ? 3.5 : 4.5,
          color: "rgba(0,0,0,0.75)",
          weight: 0.8,
          fillColor: color,
          fillOpacity: 0.95,
          renderer,
          pane: PANE_POINTS,
          bubblingMouseEvents: false,
          interactive: true,
        };
        const layer = ef === "NA" || ef === "TSTM"
          ? L.circleMarker([p.lat, p.lon], baseOpts)
          : triangleMarker([p.lat, p.lon], baseOpts);
        const popup = L.popup({ maxWidth: 600, minWidth: 360, autoPan: true, keepInView: true });
        const pointRef = p;
        layer.bindPopup(popup);
        // Stop the click from also reaching the map (which would close the popup).
        layer.on("click", (e: any) => { L.DomEvent.stopPropagation(e); });
        layer.on("popupopen", async () => {
          const initial = buildPopup(
            `Damage Point: ${(pointRef as any).event_id ?? pointRef.damage_txt ?? "—"}`,
            color, ef, pointRows(pointRef), photosFor(pointRef),
            true
          );
          popup.setContent(initial);
          const oid = (pointRef as any).objectid;
          if (typeof oid === "number") {
            const atts = await fetchDamagePointAttachments(oid);
            const merged = Array.from(new Set([...photosFor(pointRef), ...atts.map((a) => a.url)]));
            popup.setContent(buildPopup(
              `Damage Point: ${(pointRef as any).event_id ?? pointRef.damage_txt ?? "—"}`,
              color, ef, pointRows(pointRef), merged, false
            ));
          }
        });
        layer.addTo(grp);
      }
    };

    render();
    if (!cull) return;
    let raf: number | null = null;
    const onMove = () => {
      if (raf != null) return;
      raf = requestAnimationFrame(() => { raf = null; render(); });
    };
    map.on("moveend zoomend", onMove);
    return () => { map.off("moveend zoomend", onMove); if (raf != null) cancelAnimationFrame(raf); };
  }, [points, showPoints]);

  // Warnings — bucketed by kind, viewport-culled when there are many polygons.
  // A year's worth of warnings can be 50k+ features; rendering them all at once
  // (even on canvas) thrashes the GPU. We pre-compute a bbox per feature once,
  // then on every pan/zoom rebuild only the visible subset per kind.
  const warnMetaRef = useRef<Array<{ w: WarningFeature; minLat: number; maxLat: number; minLon: number; maxLon: number }>>([]);
  useEffect(() => {
    // Re-compute bbox cache whenever the warnings array identity changes.
    const meta: typeof warnMetaRef.current = [];
    for (const w of warnings) {
      let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
      const visit = (coords: any) => {
        if (typeof coords[0] === "number") {
          const [x, y] = coords;
          if (y < minLat) minLat = y; if (y > maxLat) maxLat = y;
          if (x < minLon) minLon = x; if (x > maxLon) maxLon = x;
          return;
        }
        for (const c of coords) visit(c);
      };
      if (w.geometry?.coordinates) visit(w.geometry.coordinates);
      meta.push({ w, minLat, maxLat, minLon, maxLon });
    }
    warnMetaRef.current = meta;
  }, [warnings]);

  useEffect(() => {
    const grp = warnLayer.current; const map = mapRef.current;
    if (!grp || !map) return;
    const renderer = rendWarn.current!;
    const cull = warnMetaRef.current.length > 400;

    const render = () => {
      grp.clearLayers();
      const b = cull ? map.getBounds() : null;
      const south = b?.getSouth() ?? -Infinity;
      const north = b?.getNorth() ?? Infinity;
      const west  = b?.getWest()  ?? -Infinity;
      const east  = b?.getEast()  ?? Infinity;

      const buckets: Partial<Record<WarningKind, any[]>> = {};
      for (const m of warnMetaRef.current) {
        const w = m.w;
        if (!warningToggles[w.kind]) continue;
        if (b && (m.maxLat < south || m.minLat > north || m.maxLon < west || m.minLon > east)) continue;
        (buckets[w.kind] ||= []).push({
          type: "Feature",
          geometry: w.geometry,
          properties: { id: w.id },
        });
      }
      for (const k of Object.keys(buckets) as WarningKind[]) {
        const s = settings.warnings[k];
        const fc = { type: "FeatureCollection", features: buckets[k]! };
        L.geoJSON(fc as any, {
          pane: PANE_WARN,
          interactive: false,
          style: () => ({
            color: "#000000", weight: s.weight + 1.1, opacity: 0.75,
            fill: false, fillOpacity: 0,
            renderer, pane: PANE_WARN,
          }),
        }).addTo(grp);
        L.geoJSON(fc as any, {
          pane: PANE_WARN,
          interactive: false,
          style: () => ({
            color: s.color, weight: s.weight, opacity: 0.9,
            fillColor: s.color, fillOpacity: s.fillOpacity,
            renderer, pane: PANE_WARN,
          }),
        }).addTo(grp);
      }
    };

    render();
    if (!cull) return;
    let raf: number | null = null;
    const onMove = () => {
      if (raf != null) return;
      raf = requestAnimationFrame(() => { raf = null; render(); });
    };
    map.on("moveend zoomend", onMove);
    return () => { map.off("moveend zoomend", onMove); if (raf != null) cancelAnimationFrame(raf); };
  }, [warnings, warningToggles, settings.warnings]);

  // SPC outlook — SVG renderer + per-pane defs for hatching
  useEffect(() => {
    const grp = spcLayer.current; const map = mapRef.current;
    if (!grp || !map) return;
    grp.clearLayers();
    if (!outlook) return;

    const svgRenderer = rendSpc.current!;
    ensurePatternsInPane(map, PANE_SPC, settings.spc.sig);

    const features = prepareOutlookFeatures(outlook.features);
    for (const f of features) {
      const colors = colorsForOutlook(outlook.kind, f.label, f.isSig);
      const isSig = f.isSig;
      const sigEntry = isSig ? ((settings.spc.sig as any)[f.label] ?? settings.spc.sig.SIG) : null;
      if (!f.geometry) continue;
      const layer = L.geoJSON(f.geometry, {
        pane: PANE_SPC,
        style: () => ({
          color: sigEntry ? sigEntry.color : colors.stroke,
          weight: sigEntry ? sigEntry.weight : settings.spc.weight,
          opacity: settings.spc.strokeOpacity,
          fillColor: colors.fill,
          fillOpacity: settings.spc.fillOpacity,
          renderer: svgRenderer,
          pane: PANE_SPC,
          interactive: false,
        }),
      });
      layer.addTo(grp);

      if (isSig && sigEntry) {
        const patternId = sigPatternId(f.label);
        requestAnimationFrame(() => {
          layer.eachLayer((l: any) => {
            const el: SVGPathElement | undefined = l._path;
            if (el) {
              el.setAttribute("fill", `url(#${patternId})`);
              el.setAttribute("fill-opacity", "1");
              el.setAttribute("stroke", sigEntry.color);
            }
          });
        });
      }
    }
    return () => { grp.clearLayers(); };
  }, [outlook, settings.spc]);

  // Country / State / County reference layers (lazy-loaded once each)
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    if (!settings.countries.enabled) {
      countriesLayer.current?.remove(); countriesLayer.current = null; return;
    }
    let cancelled = false;
    fetchGeo("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json")
      .then(async (raw) => {
        if (cancelled || !raw || !mapRef.current) return;
        const mod: any = await import("topojson-client").catch(() => null);
        const topo = mod?.feature ? mod : mod?.default;
        if (cancelled || !topo?.feature || !mapRef.current) return;
        const objKey = raw?.objects?.countries ? "countries" : Object.keys(raw?.objects ?? {})[0];
        const gj = topo.feature(raw, raw.objects[objKey]);
        countriesLayer.current?.remove();
        countriesLayer.current = L.geoJSON(gj, {
          pane: PANE_COUNTRIES,
          interactive: false,
          style: () => ({
            color: settings.countries.color, weight: settings.countries.weight,
            fill: false, opacity: 1, pane: PANE_COUNTRIES,
          }),
        }).addTo(mapRef.current);
      });
    return () => { cancelled = true; };
  }, [settings.countries.enabled]);
  useEffect(() => {
    if (countriesLayer.current) countriesLayer.current.setStyle({
      color: settings.countries.color, weight: settings.countries.weight, fill: false, opacity: 1,
    });
  }, [settings.countries.color, settings.countries.weight]);

  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    if (!settings.states.enabled) {
      statesLayer.current?.remove(); statesLayer.current = null; return;
    }
    let cancelled = false;
    fetchGeo("https://cdn.jsdelivr.net/gh/PublicaMundi/MappingAPI@master/data/geojson/us-states.json")
      .then((gj) => {
        if (cancelled || !gj || !mapRef.current) return;
        statesLayer.current?.remove();
        statesLayer.current = L.geoJSON(gj, {
          pane: PANE_STATES,
          interactive: false,
          style: () => ({
            color: settings.states.color, weight: settings.states.weight,
            fill: false, opacity: 1, pane: PANE_STATES,
          }),
        }).addTo(mapRef.current);
      });
    return () => { cancelled = true; };
  }, [settings.states.enabled]);
  useEffect(() => {
    if (statesLayer.current) statesLayer.current.setStyle({
      color: settings.states.color, weight: settings.states.weight, fill: false, opacity: 1,
    });
  }, [settings.states.color, settings.states.weight]);

  // Counties — viewport- and zoom-gated for performance.
  // The full US counties dataset is ~3000 polygons; rendering them all
  // everywhere makes pan/zoom slow. We only render counties intersecting
  // the current viewport and only at zoom >= 6.
  const countyFeatsRef = useRef<any[] | null>(null);
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    if (!settings.counties.enabled) {
      countiesLayer.current?.remove(); countiesLayer.current = null;
      countyFeatsRef.current = null;
      return;
    }

    let cancelled = false;
    const renderer = rendCounties.current!;

    const styleFn = () => ({
      color: settings.counties.color,
      weight: settings.counties.weight,
      fill: false, opacity: 1, pane: PANE_COUNTIES,
      dashArray: settings.counties.dashed ? "3 3" : "",
    });

    // Compute a feature's lon/lat bbox once and cache on the feature
    const bbox = (f: any): [number, number, number, number] => {
      if (f.__bbox) return f.__bbox;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const visit = (coords: any) => {
        if (typeof coords[0] === "number") {
          const [x, y] = coords;
          if (x < minX) minX = x; if (y < minY) minY = y;
          if (x > maxX) maxX = x; if (y > maxY) maxY = y;
          return;
        }
        for (const c of coords) visit(c);
      };
      visit(f.geometry.coordinates);
      f.__bbox = [minX, minY, maxX, maxY];
      return f.__bbox;
    };

    const rebuild = () => {
      if (!mapRef.current || !countyFeatsRef.current) return;
      const m = mapRef.current;
      countiesLayer.current?.remove();
      countiesLayer.current = null;
      if (m.getZoom() < 6) return; // Hide when zoomed out far
      const b = m.getBounds();
      const [w, s, e, n] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
      const visible = countyFeatsRef.current.filter((f) => {
        const [minX, minY, maxX, maxY] = bbox(f);
        return !(maxX < w || minX > e || maxY < s || minY > n);
      });
      if (!visible.length) return;
      countiesLayer.current = L.geoJSON(
        { type: "FeatureCollection", features: visible } as any,
        { pane: PANE_COUNTIES, interactive: false, renderer, style: styleFn } as any
      ).addTo(m);
    };

    let rafId: number | null = null;
    const onMove = () => {
      if (rafId != null) return;
      rafId = requestAnimationFrame(() => { rafId = null; rebuild(); });
    };

    const ensureLoaded = async () => {
      if (countyFeatsRef.current) { rebuild(); return; }
      const raw = await fetchGeo("https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json");
      if (cancelled || !raw) return;
      const mod: any = await import("topojson-client").catch(() => null);
      const topo = mod?.feature ? mod : mod?.default;
      if (!topo?.feature) { console.warn("topojson-client unavailable"); return; }
      const objKey = raw?.objects?.counties ? "counties" : Object.keys(raw?.objects ?? {})[0];
      const fc = topo.feature(raw, raw.objects[objKey]);
      countyFeatsRef.current = fc.features ?? [];
      rebuild();
    };

    ensureLoaded();
    map.on("moveend zoomend", onMove);
    return () => {
      cancelled = true;
      map.off("moveend zoomend", onMove);
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [settings.counties.enabled]);
  useEffect(() => {
    if (countiesLayer.current) countiesLayer.current.setStyle(() => ({
      color: settings.counties.color, weight: settings.counties.weight, fill: false, opacity: 1,
      dashArray: settings.counties.dashed ? "3 3" : "",
    }));
  }, [settings.counties.color, settings.counties.weight, settings.counties.dashed]);

  // WFO (County Warning Area) borders — canvas renderer for performance
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    if (!settings.wfo.enabled) {
      wfoLayer.current?.remove(); wfoLayer.current = null; return;
    }
    let cancelled = false;
    const renderer = rendWfo.current!;
    fetchGeo(
      "https://mapservices.weather.noaa.gov/static/rest/services/nws_reference_maps/nws_reference_map/MapServer/1/query?where=1%3D1&outFields=CWA,WFO&f=geojson&returnGeometry=true&outSR=4326"
    ).then((gj) => {
      if (cancelled || !gj || !mapRef.current) return;
      wfoLayer.current?.remove();
      wfoLayer.current = L.geoJSON(gj, {
        pane: PANE_WFO,
        interactive: false,
        renderer,
        style: () => ({
          color: settings.wfo.color, weight: settings.wfo.weight,
          fill: false, opacity: 1, pane: PANE_WFO,
        }),
      } as any).addTo(mapRef.current);
    });
    return () => { cancelled = true; };
  }, [settings.wfo.enabled]);
  useEffect(() => {
    if (wfoLayer.current) wfoLayer.current.setStyle(() => ({
      color: settings.wfo.color, weight: settings.wfo.weight, fill: false, opacity: 1,
    }));
  }, [settings.wfo.color, settings.wfo.weight]);

  // City + State labels — divIcons in a non-interactive top pane.
  // Cities are zoom-aware and capped per viewport so dense labels don't lag the map.
  const cityFeatsRef = useRef<any[] | null>(null);
  const cityFeatsDetailedRef = useRef<any[] | null>(null);
  const cityFeatsDetailedLoadingRef = useRef<Promise<void> | null>(null);
  const cityLayerRef = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const cs = settings.cityLabels;
    if (!cs.enabled) {
      cityLayerRef.current?.remove(); cityLayerRef.current = null; return;
    }
    let cancelled = false;

    const textShadow = cs.outlineWidth > 0
      ? (() => {
          const w = cs.outlineWidth;
          const c = cs.outlineColor;
          return [`-${w}px 0 ${c}`, `${w}px 0 ${c}`, `0 -${w}px ${c}`, `0 ${w}px ${c}`,
                  `-${w}px -${w}px ${c}`, `${w}px -${w}px ${c}`, `-${w}px ${w}px ${c}`, `${w}px ${w}px ${c}`].join(", ");
        })()
      : "none";

    const render = () => {
      if (!mapRef.current) return;
      const m = mapRef.current;
      const zoom = m.getZoom();
      // At neighborhood zooms, prefer the detailed dataset (small towns/suburbs) when available.
      const useDetailed = zoom >= 7 && cityFeatsDetailedRef.current;
      const source = useDetailed ? cityFeatsDetailedRef.current! : cityFeatsRef.current;
      if (!source) return;
      cityLayerRef.current?.remove();
      const grp = L.layerGroup();
      const b = m.getBounds();
      const south = b.getSouth(), north = b.getNorth(), west = b.getWest(), east = b.getEast();
      const minPop = cityMinPopulation(cs.density, zoom);
      const zoomScale = labelZoomScale(zoom);
      const fontSize = Math.round(cs.fontSize * zoomScale * 10) / 10;
      const size = m.getSize();
      const viewportScale = Math.max(0.35, Math.min(1.15, (size.x * size.y) / (1366 * 768)));
      const MAX = Math.round(cityLabelCap(cs.density, zoom) * viewportScale);
      // Padding around each label's bounding box (smaller = denser).
      // density 1 (sparse) → big breathing room, density 5 (dense) → labels can almost touch.
      const padX = Math.max(2, 14 - Math.round(cs.density) * 2);
      const padY = Math.max(1, 6 - Math.round(cs.density));
      // Approximate text metrics — close enough for collision and avoids measuring DOM.
      const charW = fontSize * 0.55;
      const lineH = fontSize * 1.15;

      // Collect in-view candidates (already sorted globally by population desc).
      const candidates: any[] = [];
      for (const f of source) {
        const pop = f.properties?.pop_max ?? f.properties?.population ?? 0;
        if (pop < minPop) continue;
        const [lon, lat] = f.geometry?.coordinates ?? [];
        if (typeof lat !== "number" || typeof lon !== "number") continue;
        if (lat < south || lat > north || lon < west || lon > east) continue;
        candidates.push(f);
      }

      // Bounding-box collision: bigger cities are placed first and reserve space,
      // suburbs only render if their box doesn't overlap any already-placed label.
      // This mirrors RadarScope / Radar Omega behavior around dense metros.
      type Box = { x1: number; y1: number; x2: number; y2: number };
      const placed: Box[] = [];
      const cellSize = Math.max(36, fontSize * 8);
      const grid = new Map<string, Box[]>();
      const bucket = (x: number, y: number) => `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`;
      const collides = (box: Box) => {
        const x1 = Math.floor(box.x1 / cellSize), x2 = Math.floor(box.x2 / cellSize);
        const y1 = Math.floor(box.y1 / cellSize), y2 = Math.floor(box.y2 / cellSize);
        for (let gx = x1; gx <= x2; gx++) for (let gy = y1; gy <= y2; gy++) {
          for (const p of grid.get(`${gx}:${gy}`) ?? []) {
            if (box.x1 < p.x2 && box.x2 > p.x1 && box.y1 < p.y2 && box.y2 > p.y1) return true;
          }
        }
        return false;
      };
      const storeBox = (box: Box) => {
        const x1 = Math.floor(box.x1 / cellSize), x2 = Math.floor(box.x2 / cellSize);
        const y1 = Math.floor(box.y1 / cellSize), y2 = Math.floor(box.y2 / cellSize);
        for (let gx = x1; gx <= x2; gx++) for (let gy = y1; gy <= y2; gy++) {
          const k = `${gx}:${gy}`;
          const arr = grid.get(k);
          if (arr) arr.push(box); else grid.set(k, [box]);
        }
      };
      let count = 0;
      for (const f of candidates) {
        if (count >= MAX) break;
        const [lon, lat] = f.geometry.coordinates;
        const name = f.properties?.name ?? f.properties?.NAME ?? "";
        if (!name) continue;
        const pt = m.latLngToContainerPoint([lat, lon]);
        const halfW = (String(name).length * charW) / 2 + padX;
        const halfH = lineH / 2 + padY;
        const box: Box = { x1: pt.x - halfW, y1: pt.y - halfH, x2: pt.x + halfW, y2: pt.y + halfH };
        if (collides(box)) continue;
        placed.push(box);
        storeBox(box);
        count++;
        const html = `<span class="dat-label" style="font-size:${fontSize}px;color:${cs.color};text-shadow:${textShadow}">${escapeHtml(String(name))}</span>`;
        const icon = L.divIcon({ className: "dat-label-wrap", html, iconSize: [0, 0] });
        L.marker([lat, lon], { icon, pane: PANE_LABELS, interactive: false, keyboard: false }).addTo(grp);
      }
      grp.addTo(m);
      cityLayerRef.current = grp;
    };

    const loadDetailed = () => {
      if (cityFeatsDetailedRef.current) return Promise.resolve();
      if (cityFeatsDetailedLoadingRef.current) return cityFeatsDetailedLoadingRef.current;
      // GeoNames US cities with population >= 1000. Includes suburbs like Hilliard, OH
      // without downloading the full worldwide dataset.
      const url = "https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/geonames-all-cities-with-a-population-1000/exports/geojson?lang=en&timezone=UTC&where=country_code%3D%27US%27";
      const p = fetchGeo(url).then((gj) => {
        if (!gj?.features) return;
        cityFeatsDetailedRef.current = (gj.features as any[])
          .map((f) => {
            // Normalize population field for sorting/filtering.
            const pop = f.properties?.population ?? f.properties?.pop_max ?? 0;
            f.properties = { ...f.properties, pop_max: pop, name: f.properties?.name ?? f.properties?.ascii_name };
            return f;
          })
          .sort((a, b) => (b.properties?.pop_max ?? 0) - (a.properties?.pop_max ?? 0));
      }).catch(() => { /* fall back to ne_10m */ })
        .finally(() => { cityFeatsDetailedLoadingRef.current = null; });
      cityFeatsDetailedLoadingRef.current = p;
      return p;
    };

    const ensureLoaded = async () => {
      if (!cityFeatsRef.current) {
        const url = "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_10m_populated_places_simple.geojson";
        const gj = await fetchGeo(url);
        if (cancelled || !gj?.features) return;
        cityFeatsRef.current = (gj.features as any[]).sort(
          (a, b) => (b.properties?.pop_max ?? 0) - (a.properties?.pop_max ?? 0)
        );
      }
      render();
      // If we're already zoomed in, kick off the detailed dataset load.
      if (mapRef.current && mapRef.current.getZoom() >= 6) {
        loadDetailed().then(() => { if (!cancelled) render(); });
      }
    };

    ensureLoaded();
    let raf: number | null = null;
    const onMove = () => {
      if (raf != null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        render();
        if (mapRef.current && mapRef.current.getZoom() >= 6 && !cityFeatsDetailedRef.current) {
          loadDetailed().then(() => { if (!cancelled) render(); });
        }
      });
    };
    map.on("moveend zoomend", onMove);
    return () => {
      cancelled = true;
      map.off("moveend zoomend", onMove);
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [
    settings.cityLabels.enabled, settings.cityLabels.density,
    settings.cityLabels.fontSize, settings.cityLabels.color,
    settings.cityLabels.outlineColor, settings.cityLabels.outlineWidth,
  ]);


  // State labels — hide when zoomed in and scale gently with zoom to reduce clutter.
  const stateLabelLayerRef = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const ss = settings.stateLabels;
    stateLabelLayerRef.current?.remove(); stateLabelLayerRef.current = null;
    if (!ss.enabled) return;
    const textShadow = ss.outlineWidth > 0
      ? (() => {
          const w = ss.outlineWidth, c = ss.outlineColor;
          return [`-${w}px 0 ${c}`, `${w}px 0 ${c}`, `0 -${w}px ${c}`, `0 ${w}px ${c}`,
                  `-${w}px -${w}px ${c}`, `${w}px -${w}px ${c}`, `-${w}px ${w}px ${c}`, `${w}px ${w}px ${c}`].join(", ");
        })()
      : "none";
    const render = () => {
      if (!mapRef.current) return;
      const m = mapRef.current;
      stateLabelLayerRef.current?.remove(); stateLabelLayerRef.current = null;
      const zoom = m.getZoom();
      if (zoom >= 7) return;
      const b = m.getBounds();
      const fontSize = Math.round(ss.fontSize * labelZoomScale(zoom) * 10) / 10;
      const grp = L.layerGroup();
      for (const st of US_STATE_CENTROIDS) {
        if (!b.pad(0.35).contains([st.lat, st.lon])) continue;
        const html = `<span class="dat-label dat-state-label" style="font-size:${fontSize}px;color:${ss.color};text-shadow:${textShadow}">${escapeHtml(st.code)}</span>`;
        const icon = L.divIcon({ className: "dat-label-wrap", html, iconSize: [0, 0] });
        L.marker([st.lat, st.lon], { icon, pane: PANE_LABELS, interactive: false, keyboard: false }).addTo(grp);
      }
      grp.addTo(m);
      stateLabelLayerRef.current = grp;
    };
    render();
    let raf: number | null = null;
    const onMove = () => {
      if (raf != null) return;
      raf = requestAnimationFrame(() => { raf = null; render(); });
    };
    map.on("moveend zoomend", onMove);
    return () => {
      map.off("moveend zoomend", onMove);
      if (raf != null) cancelAnimationFrame(raf);
      stateLabelLayerRef.current?.remove(); stateLabelLayerRef.current = null;
    };
  }, [
    settings.stateLabels.enabled, settings.stateLabels.fontSize,
    settings.stateLabels.color, settings.stateLabels.outlineColor,
    settings.stateLabels.outlineWidth,
  ]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {outlook && <SpcLegend kind={outlook.kind} date={outlookDate ?? new Date()} />}
    </div>
  );
}

// ===== Hatching defs injected into the SPC pane's SVG =====

function sigPatternId(label: string): string {
  if (label === "CIG3") return "sig-pat-CIG3";
  if (label === "CIG2") return "sig-pat-CIG2";
  if (label === "CIG1") return "sig-pat-CIG1";
  return "sig-pat-SIG";
}

function ensurePatternsInPane(map: L.Map, paneName: string, sig: Record<string, { color: string; weight: number }>) {
  const pane = map.getPane(paneName);
  if (!pane) return;
  const svg = pane.querySelector("svg") as SVGSVGElement | null;
  if (!svg) {
    requestAnimationFrame(() => ensurePatternsInPane(map, paneName, sig));
    return;
  }
  svg.querySelector("#sig-pattern-defs")?.remove();
  const NS = "http://www.w3.org/2000/svg";
  const defs = document.createElementNS(NS, "defs");
  defs.setAttribute("id", "sig-pattern-defs");
  // Intensity-style hatching matching SPC legend.
  // CIG2 intentionally runs opposite CIG1 (135°) and is dashed.
  const sw = (k: string) => Math.max(0.6, sig[k]?.weight ?? 1);
  const col = (k: string) => sig[k]?.color ?? "#000";
  // Sparser spacing keeps the hatching readable when the user zooms in.
  defs.appendChild(buildPattern("sig-pat-SIG", 28, [
    { type: "line", attrs: { x1: 0, y1: 0, x2: 0, y2: 28, stroke: col("SIG"), "stroke-width": sw("SIG") } },
  ], "rotate(45)"));
  defs.appendChild(buildPattern("sig-pat-CIG1", 28, [
    { type: "line", attrs: { x1: 0, y1: 0, x2: 0, y2: 28, stroke: col("CIG1"), "stroke-width": sw("CIG1") } },
  ], "rotate(45)"));
  defs.appendChild(buildPattern("sig-pat-CIG2", 20, [
    { type: "line", attrs: { x1: 0, y1: 20, x2: 20, y2: 0, stroke: col("CIG2"), "stroke-width": sw("CIG2"), "stroke-dasharray": "5 4" } },
  ]));
  defs.appendChild(buildPattern("sig-pat-CIG3", 20, [
    { type: "line", attrs: { x1: 0, y1: 0, x2: 0, y2: 20, stroke: col("CIG3"), "stroke-width": sw("CIG3") } },
    { type: "line", attrs: { x1: 0, y1: 0, x2: 20, y2: 0, stroke: col("CIG3"), "stroke-width": sw("CIG3") } },
  ], "rotate(45)"));
  svg.insertBefore(defs, svg.firstChild);
}

function prepareOutlookFeatures(features: OutlookResult["features"]) {
  // Process strongest first so weaker categories don't paint over them.
  const sigRank: Record<string, number> = { CIG3: 4, CIG2: 3, CIG1: 2, SIG: 1 };
  const sigFeatures = features.filter((f) => f.isSig).sort((a, b) => (sigRank[b.label] ?? 0) - (sigRank[a.label] ?? 0));
  const nonSig = features.filter((f) => !f.isSig);
  const taken: Geometry[] = [];
  const processedSig = sigFeatures.map((f) => {
    let geometry = geoJsonToMartinez(f.geometry);
    if (geometry) {
      for (const used of taken) geometry = geometry ? diff(geometry, used) : null;
      if (geometry) taken.push(geometry);
    }
    return { ...f, geometry: martinezToGeoJson(geometry) };
  });
  // Render order: SIG/CIG hatch fills first (weakest to strongest), then tornado %/cat fills on top.
  const sigWeakestFirst = [...processedSig].reverse();
  return [...sigWeakestFirst, ...nonSig];
}

function geoJsonToMartinez(geometry: any): Geometry | null {
  if (!geometry) return null;
  if (geometry.type === "Polygon") return geometry.coordinates as Geometry;
  if (geometry.type === "MultiPolygon") return geometry.coordinates as Geometry;
  return null;
}

function martinezToGeoJson(geometry: Geometry | null): any | null {
  const g = geometry as any;
  if (!g || !Array.isArray(g) || g.length === 0) return null;
  const isPolygon = typeof g?.[0]?.[0]?.[0] === "number";
  return isPolygon
    ? { type: "Polygon", coordinates: g }
    : { type: "MultiPolygon", coordinates: g };
}

function buildPattern(
  id: string, size: number,
  shapes: { type: "line" | "circle" | "rect"; attrs: Record<string, any> }[],
  patternTransform?: string
): SVGPatternElement {
  const NS = "http://www.w3.org/2000/svg";
  const pat = document.createElementNS(NS, "pattern");
  pat.setAttribute("id", id);
  pat.setAttribute("patternUnits", "userSpaceOnUse");
  pat.setAttribute("width", String(size));
  pat.setAttribute("height", String(size));
  if (patternTransform) pat.setAttribute("patternTransform", patternTransform);
  for (const s of shapes) {
    const el = document.createElementNS(NS, s.type);
    for (const [k, v] of Object.entries(s.attrs)) el.setAttribute(k, String(v));
    pat.appendChild(el);
  }
  return pat;
}

async function fetchGeo(url: string): Promise<any | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

function linePopupLatLng(ln: DamageLine): L.LatLngExpression {
  const path = ln.paths?.find((ring) => ring.length > 0);
  if (path?.length) return path[Math.floor(path.length / 2)];
  if (Number.isFinite(ln.startlat) && Number.isFinite(ln.startlon)) return [ln.startlat, ln.startlon];
  return [39, -96];
}

function openLineDatPopup(map: L.Map, ln: DamageLine, color: string, ef: string, latLng: L.LatLngExpression) {
  L.popup({ maxWidth: 720, minWidth: 360, autoPan: true, closeOnClick: false, keepInView: true })
    .setLatLng(latLng)
    .setContent(buildPopup(`Damage Lines: ${ln.event_id ?? "—"}`, color, ef, lineRows(ln), [], false, true))
    .openOn(map);
}

function findNearestLineHit(map: L.Map, lines: LineHitMeta[], latLng: L.LatLng, isTouch: boolean): LineHitMeta | null {
  if (!lines.length) return null;
  const click = map.latLngToContainerPoint(latLng);
  const threshold = isTouch ? 18 : 11;
  let best: LineHitMeta | null = null;
  let bestDistSq = threshold * threshold;
  const view = map.getBounds().pad(0.1);
  for (const meta of lines) {
    for (const ring of meta.positions) {
      if (ring.length < 2) continue;
      for (let i = 1; i < ring.length; i++) {
        const aLatLng = ring[i - 1];
        const bLatLng = ring[i];
        if (!view.contains(aLatLng) && !view.contains(bLatLng)) continue;
        const a = map.latLngToContainerPoint(aLatLng);
        const b = map.latLngToContainerPoint(bLatLng);
        const d = pointSegmentDistanceSq(click, a, b);
        if (d <= bestDistSq) { bestDistSq = d; best = meta; }
      }
    }
  }
  return best;
}

function pointSegmentDistanceSq(p: L.Point, a: L.Point, b: L.Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return (p.x - a.x) ** 2 + (p.y - a.y) ** 2;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  const x = a.x + t * dx;
  const y = a.y + t * dy;
  return (p.x - x) ** 2 + (p.y - y) ** 2;
}

// ===== popup helpers =====

function colorsForOutlook(kind: "cat" | "torn", label: string, isSig: boolean) {
  if (isSig) return { fill: "#000000", stroke: "#000000" };
  if (kind === "cat") return CAT_COLORS[label] ?? { fill: "#888", stroke: "#444" };
  return TORN_COLORS[label] ?? { fill: "#888", stroke: "#444" };
}

const POINT_FIELDS: [string, string, ((v: any) => string)?][] = [
  ["Storm date", "stormdate", fmtDate],
  ["Survey date", "surveydate", fmtDate],
  ["Event ID", "event_id"],
  ["Damage", "damage_txt"],
  ["DOD", "dod_txt"],
  ["EF Scale", "efscale"],
  ["Wind speed", "windspeed"],
  ["Injuries", "injuries"],
  ["Deaths", "deaths"],
  ["Latitude", "lat"],
  ["Longitude", "lon"],
  ["WFO", "office"],
  ["State", "state"],
  ["Comments", "comments"],
];

const LINE_FIELDS: [string, string, ((v: any) => string)?][] = [
  ["event_id", "event_id"],
  ["stormdate", "stormdate", fmtDate],
  ["starttime", "starttime", fmtDate],
  ["endtime", "endtime", fmtDate],
  ["startlat", "startlat"],
  ["startlon", "startlon"],
  ["endlat", "endlat"],
  ["endlon", "endlon"],
  ["length", "length"],
  ["width", "width"],
  ["injuries", "injuries"],
  ["fatalities", "fatalities"],
  ["efscale", "efscale"],
  ["efnum", "efnum"],
  ["qc", "qc"],
  ["maxwind", "maxwind"],
  ["cropdamage", "cropdamage"],
  ["propdamage", "propdamage"],
  ["wfo", "wfo"],
  ["state", "state"],
  ["comments", "comments"],
];

function pointRows(p: any) { return POINT_FIELDS.map(([l, k, f]) => [l, fmtVal(p[k], f)] as [string, string]); }
function lineRows(ln: any) { return LINE_FIELDS.map(([l, k, f]) => [l, fmtVal(ln[k], f)] as [string, string]); }

function fmtVal(v: any, fmt?: (v: any) => string): string {
  if (v === null || v === undefined || v === "") return "—";
  if (fmt) return fmt(v);
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "—";
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }
  return String(v);
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function labelZoomScale(zoom: number): number {
  if (zoom <= 4) return 0.86;
  if (zoom <= 6) return 1;
  if (zoom <= 8) return 1.12;
  return 1.22;
}

function cityMinPopulation(density: number, zoom: number): number {
  // 7 zoom buckets: <5, <6, <7, <8, <10, <12, >=12
  const tiers: Record<number, [number, number, number, number, number, number, number]> = {
    1: [5_000_000, 2_500_000, 1_250_000, 500_000, 175_000, 75_000, 30_000],
    2: [3_000_000, 1_250_000, 500_000, 175_000, 50_000, 20_000, 8_000],
    3: [1_250_000, 500_000, 175_000, 50_000, 15_000, 5_000, 2_000],
    4: [500_000, 175_000, 50_000, 12_000, 3_000, 1_000, 250],
    5: [175_000, 50_000, 12_000, 2_500, 500, 0, 0],
  };
  const idx = zoom < 5 ? 0 : zoom < 6 ? 1 : zoom < 7 ? 2 : zoom < 8 ? 3 : zoom < 10 ? 4 : zoom < 12 ? 5 : 6;
  return (tiers[Math.round(density)] ?? tiers[3])[idx];
}

function cityLabelCap(density: number, zoom: number): number {
  const base = zoom < 5 ? 90 : zoom < 7 ? 260 : zoom < 9 ? 700 : zoom < 11 ? 1300 : 2400;
  return Math.round(base * (0.65 + Math.round(density) * 0.25));
}

function cityLabelMinGap(density: number, zoom: number): number {
  const densityFactor = Math.max(0, Math.min(4, Math.round(density) - 1));
  const zoomFactor = zoom >= 12 ? 4 : zoom >= 10 ? 7 : zoom >= 8 ? 12 : zoom >= 6 ? 22 : 34;
  return Math.max(3, zoomFactor - densityFactor * 3);
}

// Pull every URL-looking field from a damage point so we can render photo links.
function photosFor(p: any): string[] {
  const out = new Set<string>();
  const candidates = [
    p.image, p.image1, p.image2, p.image3, p.imagelink,
    p.photo, p.photo1, p.photo2, p.photourl, p.photo_url,
    p.attachment, p.attachmenturl, p.url,
  ];
  for (const c of candidates) {
    if (typeof c === "string") {
      // split on commas / whitespace; keep http(s) URLs only
      for (const piece of c.split(/[,\s;]+/)) {
        const u = piece.trim();
        if (/^https?:\/\//i.test(u)) out.add(u);
      }
    }
  }
  return [...out];
}

function buildPopup(
  title: string, color: string, badge: string,
  rows: [string, string][], photos: string[] = [], loading: boolean = false,
  officialDense: boolean = false
): string {
  const body = rows
    .map(([k, v]) => `<tr><td class="dat-popup-key">${escapeHtml(k)}</td><td class="dat-popup-val">${escapeHtml(v)}</td></tr>`)
    .join("");
  const photoHtml = photos.length
    ? `<div class="dat-popup-photos"><div class="dat-popup-photos-title">Photos (${photos.length})</div>` +
      photos.map((u, i) => `<a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer">Photo ${i + 1} ↗</a>`).join("") +
      `</div>`
    : loading
      ? `<div class="dat-popup-photos"><div class="dat-popup-photos-title">Loading photos…</div></div>`
      : "";
  return `
    <div class="dat-popup${officialDense ? " dat-popup-dense" : ""}">
      <div class="dat-popup-header" style="background:${color}">
        <span class="dat-popup-badge">${escapeHtml(badge)}</span>
        <span class="dat-popup-title">${escapeHtml(title)}</span>
      </div>
      <div class="dat-popup-body"><table><tbody>${body}</tbody></table>${photoHtml}</div>
    </div>`;
}

function SpcLegend({ kind, date }: { kind: "cat" | "torn"; date: Date }) {
  const cig = useCigLegend(date);

  if (kind === "cat") {
    // Categorical — numbered boxed rows like SPC site
    const rows: { num: string; code: string; label: string; fill: string; stroke: string }[] = [
      { num: "5", code: "HIGH", label: "High",        fill: CAT_COLORS.HIGH.fill, stroke: CAT_COLORS.HIGH.stroke },
      { num: "4", code: "MDT",  label: "Moderate",    fill: CAT_COLORS.MDT.fill,  stroke: CAT_COLORS.MDT.stroke },
      { num: "3", code: "ENH",  label: "Enhanced",    fill: CAT_COLORS.ENH.fill,  stroke: CAT_COLORS.ENH.stroke },
      { num: "2", code: "SLGT", label: "Slight",      fill: CAT_COLORS.SLGT.fill, stroke: CAT_COLORS.SLGT.stroke },
      { num: "1", code: "MRGL", label: "Marginal",    fill: CAT_COLORS.MRGL.fill, stroke: CAT_COLORS.MRGL.stroke },
      { num: "",  code: "TSTM", label: "Thunderstorms", fill: CAT_COLORS.TSTM.fill, stroke: CAT_COLORS.TSTM.stroke },
    ];
    return (
      <div className="pointer-events-none absolute bottom-3 right-3 z-[400] rounded-md border border-border bg-panel/95 p-2 text-[11px] text-foreground shadow-lg backdrop-blur">
        <div className="mb-1 text-center text-[11px] font-bold uppercase tracking-wide">Risk Level</div>
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.code} className="flex items-center gap-2">
              <NumBox num={r.num} fill={r.fill} stroke={r.stroke} />
              <span className="font-medium">{r.label}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // Tornado — probability boxes + intensity column
  const probs: { pct: string; key: string }[] = [
    { pct: "60%", key: "0.60" },
    { pct: "45%", key: "0.45" },
    { pct: "30%", key: "0.30" },
    { pct: "15%", key: "0.15" },
    { pct: "10%", key: "0.10" },
    { pct: "5%",  key: "0.05" },
    { pct: "2%",  key: "0.02" },
  ];
  const intensities = cig
    ? [
        { num: "3", label: "CIG 3", patternId: "sig-pat-CIG3" },
        { num: "2", label: "CIG 2 dashed", patternId: "sig-pat-CIG2" },
        { num: "1", label: "CIG 1", patternId: "sig-pat-CIG1" },
      ]
    : [{ num: "", label: "Significant", patternId: "sig-pat-SIG" }];
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-[400] rounded-md border border-border bg-panel/95 p-2 text-[11px] text-foreground shadow-lg backdrop-blur">
      <div className="mb-1 text-center text-[11px] font-bold uppercase tracking-wide">Tornado</div>
      <div className="flex gap-3">
        <div>
          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Probability</div>
          <ul className="space-y-1">
            {probs.map((p) => {
              const c = TORN_COLORS[p.key];
              return (
                <li key={p.key} className="flex items-center gap-1.5">
                  <NumBox num={p.pct} fill={c.fill} stroke={c.stroke} wide />
                </li>
              );
            })}
          </ul>
        </div>
        <div>
          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Intensity</div>
          <ul className="space-y-1">
            {intensities.map((it) => (
              <li key={it.num} className="flex items-center gap-1.5">
                <HatchBox patternId={it.patternId} num={it.num} />
                <span className="text-[10px] font-medium">{it.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function NumBox({ num, fill, stroke, wide }: { num: string; fill: string; stroke: string; wide?: boolean }) {
  return (
    <span
      className={`inline-flex ${wide ? "w-12" : "w-7"} items-center justify-center rounded-[3px] px-1 py-0.5 text-[11px] font-bold leading-none`}
      style={{ background: fill, border: `2px solid ${stroke}`, color: "#000", textShadow: "0 0 2px rgba(255,255,255,0.7)" }}
    >
      {num || "\u00A0"}
    </span>
  );
}

function HatchBox({ patternId, num }: { patternId: string; num: string }) {
  // Render a tiny SVG that uses the same defs in the SPC pane (or inline fallback)
  return (
    <span className="relative inline-flex h-5 w-10 items-center justify-center rounded-[3px] border-2 border-black bg-white text-[11px] font-bold leading-none text-black">
      <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <pattern id={`legend-${patternId}`} patternUnits="userSpaceOnUse" width={patternId.endsWith("CIG3") ? 6 : patternId.endsWith("CIG2") ? 5 : 8} height={patternId.endsWith("CIG3") ? 6 : patternId.endsWith("CIG2") ? 5 : 8} patternTransform={patternId.endsWith("CIG2") ? undefined : "rotate(45)"}>
            <line x1="0" y1={patternId.endsWith("CIG2") ? "8" : "0"} x2={patternId.endsWith("CIG2") ? "8" : "0"} y2="8" stroke="#000" strokeWidth={patternId.endsWith("CIG3") ? 1.4 : 1.1} strokeDasharray={patternId.endsWith("CIG2") ? "3 2" : undefined} />
            {patternId.endsWith("CIG3") && <line x1="0" y1="0" x2="8" y2="0" stroke="#000" strokeWidth="1.4" />}
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#legend-${patternId})`} />
      </svg>
      <span className="relative">{num}</span>
    </span>
  );
}
