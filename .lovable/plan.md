# DAT Site Overhaul Plan

This is a large request. I'll group it into phases so I can ship steadily without breaking the app.

## Phase 1 — Performance & Defaults

- Default date range on first load: today → 4 days back (matches NWS DAT).
- Stop the lag on toggles and large datasets:
  - Render Leaflet layers via a single `L.LayerGroup` (or `L.canvas`) imperatively instead of one React `<CircleMarker>` / `<Polyline>` per feature. This removes the React re-render storm when toggling thousands of points/lines.
  - Use Leaflet's canvas renderer (`preferCanvas` already on) and bind popups lazily (only built on click).
  - Memoize filtered arrays; avoid recomputing state lookups on every render.

## Phase 2 — Date Filter UX

- Restore calendar grid look (shadcn `Calendar`), but add Month + Year `<Select>` dropdowns above the grid (custom `Caption` with `captionLayout="dropdown"` on `react-day-picker`).
- Day grid follows the chosen month/year exactly like the old NWS site.
- Keep "Apply" button so nothing fetches until clicked. Two calendars (From / To) side-by-side or stacked.

## Phase 3 — Colors & Marker Shape (NWS DAT match)

- New `EF_COLORS`:
  - N/A (no efscale at all) → light gray `#cfd4da` (kept as circle)
  - EFU → dark gray `#5a6168`
  - EF0 → light blue `#7ec8ff`
  - EF1 → lime `#7fe34d`
  - EF2 → yellow `#ffd23a`
  - EF3 → orange `#ff8a1f`
  - EF4 → red `#e02323`
  - EF5 → purple `#a020f0`
- Damage points: render as small **inverted triangles** using a Leaflet `divIcon` (CSS triangle), slightly smaller than current circles. Unknown stays as circle.
- Lines stay as colored polylines.

## Phase 4 — Popup Fix

- Current popup renders a JSX table inside a Leaflet popup using React portal — the "columns of letters" issue is leftover styling. Switch to `bindPopup(htmlString)` so Leaflet renders plain HTML deterministically. Two-column key/value table with proper widths.

## Phase 5 — Region Filter Rework

Replace existing `REGIONS`:
- **Northeast**: ME, VT, NH, MA, RI, NY, CT
- **Midwest**: OH, IN, MI, IL, WI, MN, IA, MO
- **Great Plains**: ND, SD, NE, KS, OK, TX
- **Mid-Atlantic**: PA, NJ, DE, MD, WV, VA
- **Southeast**: SC, GA, FL, AL
- **Pacific Northwest**: WA, OR, ID
- (West and South removed)

Add separate **Experimental Regions** panel (geographic, not state-bounded). Implement as polygon definitions (lat/lon arrays approximated from the reference image) and use point-in-polygon against feature locations:
- Northern Plains, Central Plains, Southern Plains, Midwest (Great Lakes), Ozarks, Ohio River Valley, Southeast, Mid-South, Texas Hill Country
- Plus suggested: Tennessee Valley, Lower Mississippi, Upper Mississippi, Mid-Atlantic (geographic)

Selecting an experimental region overrides state filter for that query.

## Phase 6 — Sidebar Reorg (Collapsible Panels)

Date range stays at top (applies to everything except SPC Outlooks). Below it, three collapsible accordion sections:
1. **DAT Data** — EF filters, state/region filters, point/line toggles, counts. (Everything currently in sidebar except date range.)
2. **Warnings** — see Phase 7.
3. **SPC Outlooks** — see Phase 8.

## Phase 7 — Warnings Layer

Source: NWS IEM Cow / archive ArcGIS service for warnings polygons (`https://mapservices.weather.noaa.gov/...` for live, IEM for archive). For arbitrary date ranges, use IEM's `https://mesonet.agron.iastate.edu/cgi-bin/request/gis/watchwarn.py` (returns shapefile) or their VTEC GeoJSON endpoint. I'll use IEM's GeoJSON for the date-range query.

Toggles:
- Severe Thunderstorm Warning — NWS yellow `#ffe135` (hex `#FFE135` from NWS style)
- Destructive Severe Thunderstorm — orange `#ff8c00`
- Tornado Warning — NWS red `#ff0000`
- PDS Tornado Warning — purple `#9400d3`
- Tornado Emergency — pink `#ff69b4`

Only fetch & render warnings inside current date range. Draw as polygons via canvas LayerGroup (perf). Lazy-fetch on first toggle on.

## Phase 8 — SPC Outlooks

Standalone date picker (independent of main range), outlook chooser combining type + issuance time:
- Categorical (06z), Tornado (06z), Categorical (13z), Tornado (13z), Categorical (1630z), Tornado (1630z), Categorical (20z), Tornado (20z), Categorical (01z), Tornado (01z)

"Generate" button fetches from SPC archive:
`https://www.spc.noaa.gov/products/outlook/archive/<YYYY>/KWNSPTSDY1_<YYYYMMDDHHMM>.txt` — but we want polygons, so use the SPC GeoJSON archive:
`https://www.spc.noaa.gov/products/outlook/archive/<YYYY>/day1otlk_<YYYYMMDD>_<HHMM>_cat.lyr.geojson` (and `_torn`).

Bottom-right legend:
- Categorical: TSTM, MRGL, SLGT, ENH, MDT, HIGH (official SPC hex codes)
- Tornado: 2%, 5%, 10%, 15%, 30%, 45%, 60%, plus SIG (hatched). For post-2025 changes: CIG1/CIG2/CIG3 hatch variants. Pre-change dates show classic SIG legend.

## Technical Notes (for the technically inclined)

- Convert per-feature React components to imperative `L.LayerGroup` populated in a `useEffect` keyed on `(filteredPoints, filteredLines, showPoints, showLines)`. Big perf win.
- Popups via `layer.bindPopup(htmlString)` — no React reconciliation per feature.
- Calendar: pass `captionLayout="dropdown-buttons"` and `fromYear`/`toYear` to shadcn `Calendar` (react-day-picker). Wrap two calendars in an "Apply" form.
- Experimental regions: store polygons in `src/lib/experimental-regions.ts`; reuse existing `pointInRing`.
- Warnings fetch: `https://mesonet.agron.iastate.edu/geojson/sbw.geojson?sts=...&ets=...` — filter client-side by phenom/sig/tags (`TORNADO_DAMAGE_THREAT`, `THUNDERSTORM_DAMAGE_THREAT=DESTRUCTIVE`).
- SPC layer URL pattern verified per archive year. Older archives use slightly different paths — fallback chain.

## Files Touched

- `src/lib/dat.ts` — colors, default range helper
- `src/lib/experimental-regions.ts` — new
- `src/lib/warnings.ts` — new (IEM fetch)
- `src/lib/spc.ts` — new (SPC fetch)
- `src/components/DatMap.tsx` — imperative layers, triangle icons, HTML popups, warnings + SPC overlays, legend
- `src/components/DatSidebar.tsx` — accordion sections, calendar with dropdown caption, region rework, warnings & SPC panels
- `src/routes/index.tsx` — wire new state, default range
- `src/styles.css` — popup fixes, triangle icon, legend

## Out of Scope / Risks

- Warnings archive coverage depends on IEM availability; very large date ranges (>1 year) will be capped to avoid browser OOM (I'll cap at 60 days for warnings with a notice).
- SPC archive URLs change occasionally; if a date 404s the user gets a clear message.

Want me to ship it all in one go, or split into Phase 1–4 first (perf + UX + colors + popup) and then Phase 5–8?