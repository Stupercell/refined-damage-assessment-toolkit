import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchDamage,
  type DatResult,
  type EFScale,
  EF_ORDER,
  efOf,
  defaultRange,
} from "@/lib/dat";
import {
  EXPERIMENTAL_REGIONS,
  pointInRegion,
  regionByName,
} from "@/lib/experimental-regions";
import {
  fetchWarnings,
  type WarningFeature,
  type WarningKind,
} from "@/lib/warnings";
import {
  fetchSpcOutlook,
  OUTLOOK_OPTIONS,
  type OutlookResult,
} from "@/lib/spc";
import DatSidebar from "@/components/DatSidebar";
import SettingsDialog from "@/components/SettingsDialog";
import AuthDialog from "@/components/AuthDialog";
import DisclaimerDialog from "@/components/DisclaimerDialog";
import { useAppSettings } from "@/lib/settings";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

const DatMap = lazy(() => import("@/components/DatMap"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NWS Damage Assessment — Live Viewer" },
      { name: "description", content: "Live viewer for the NWS Damage Assessment Toolkit with Warnings and SPC Outlook overlays." },
    ],
  }),
  component: Index,
});

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

function Index() {
  const [data, setData] = useState<DatResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeEFPoints, setActiveEFPoints] = useState<Set<EFScale>>(() => new Set(EF_ORDER));
  const [activeEFLines, setActiveEFLines] = useState<Set<EFScale>>(() => new Set(EF_ORDER));
  const [selectedStates, setSelectedStates] = useState<Set<string>>(new Set());
  const [selectedExpRegion, setSelectedExpRegion] = useState<string | null>(null);
  const [selectedWfos, setSelectedWfos] = useState<Set<string>>(new Set());
  const [showPoints, setShowPoints] = useState(false); // OFF by default
  const [showLines, setShowLines] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(380);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const dragRef = useRef<{ active: boolean; startX: number; startW: number }>({ active: false, startX: 0, startW: 380 });

  // Detect mobile (Tailwind md breakpoint = 768px) and default sidebar accordingly
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => { setIsMobile(mq.matches); setSidebarOpen(!mq.matches); };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const onDragStart = (e: React.MouseEvent) => {
    dragRef.current = { active: true, startX: e.clientX, startW: sidebarWidth };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current.active) return;
      const w = Math.min(720, Math.max(260, dragRef.current.startW + (ev.clientX - dragRef.current.startX)));
      setSidebarWidth(w);
    };
    const onUp = () => {
      dragRef.current.active = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      // Trigger leaflet resize
      window.dispatchEvent(new Event("resize"));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const { settings, setSettings, reset: resetSettings, session } = useAppSettings();

  const [startDate, setStartDate] = useState<Date>(() => defaultRange().start);
  const [endDate, setEndDate] = useState<Date>(() => defaultRange().end);

  const [warningToggles, setWarningTogglesState] = useState<Record<WarningKind, boolean>>({
    svr: false, destrSvr: false, tor: false, pdsTor: false, torE: false,
  });
  const [warnings, setWarnings] = useState<WarningFeature[]>([]);
  const [warningsLoading, setWarningsLoading] = useState(false);
  const [warningsError, setWarningsError] = useState<string | null>(null);
  const [warningsCapped, setWarningsCapped] = useState(false);

  const [spcDate, setSpcDate] = useState<Date>(() => new Date());
  const [spcChoice, setSpcChoice] = useState<string>(() => OUTLOOK_OPTIONS[0].key);
  const [spcLoading, setSpcLoading] = useState(false);
  const [spcError, setSpcError] = useState<string | null>(null);
  const [outlook, setOutlook] = useState<OutlookResult | null>(null);
  const [outlookDate, setOutlookDate] = useState<Date | null>(null);

  useEffect(() => setMounted(true), []);

  const datAbort = useRef<AbortController | null>(null);
  const load = useCallback(async (s: Date, e: Date) => {
    datAbort.current?.abort();
    const ac = new AbortController();
    datAbort.current = ac;
    setLoading(true); setError(null);
    try {
      const r = await fetchDamage(s.getTime(), e.getTime(), ac.signal);
      if (!ac.signal.aborted) setData(r);
    } catch (err: any) {
      if (err?.name !== "AbortError") setError(err?.message ?? "Failed to load damage data");
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => { load(startDate, endDate); }, [startDate, endDate, load]);

  const warnAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    warnAbort.current?.abort();
    const ac = new AbortController();
    warnAbort.current = ac;
    setWarningsLoading(true); setWarningsError(null);
    fetchWarnings(startDate.getTime(), endDate.getTime(), ac.signal)
      .then((r) => {
        if (ac.signal.aborted) return;
        setWarnings(r.features); setWarningsCapped(r.capped);
      })
      .catch((err) => {
        if (err?.name !== "AbortError") setWarningsError(err?.message ?? "Failed to load warnings");
      })
      .finally(() => { if (!ac.signal.aborted) setWarningsLoading(false); });
  }, [startDate, endDate]);

  const points = data?.points ?? [];
  const lines = data?.lines ?? [];
  const expRegion = selectedExpRegion ? regionByName(selectedExpRegion) ?? null : null;

  const wfoOf = (v: any): string | null => {
    const o = v?.office ?? v?.wfo;
    return typeof o === "string" && o ? o.toUpperCase() : null;
  };

  const filteredPoints = useMemo(
    () => points.filter((p) => {
      if (!activeEFPoints.has(efOf(p))) return false;
      if (selectedWfos.size > 0) { const w = wfoOf(p); if (!w || !selectedWfos.has(w)) return false; }
      if (expRegion) return pointInRegion(p.lat, p.lon, expRegion);
      if (selectedStates.size > 0) return p.state ? selectedStates.has(p.state) : false;
      return true;
    }),
    [points, activeEFPoints, selectedStates, selectedWfos, expRegion]
  );

  const filteredLines = useMemo(
    () => lines.filter((ln) => {
      const ef = efOf(ln);
      if (ef === "TSTM" || !activeEFLines.has(ef)) return false;
      if (selectedWfos.size > 0) { const w = wfoOf(ln); if (!w || !selectedWfos.has(w)) return false; }
      if (expRegion) {
        if (ln.paths?.length) {
          for (const ring of ln.paths) for (const [la, lo] of ring) {
            if (pointInRegion(la, lo, expRegion)) return true;
          }
          return false;
        }
        return pointInRegion(ln.startlat, ln.startlon, expRegion) ||
               pointInRegion(ln.endlat, ln.endlon, expRegion);
      }
      if (selectedStates.size > 0) return ln.state ? selectedStates.has(ln.state) : false;
      return true;
    }),
    [lines, activeEFLines, selectedStates, selectedWfos, expRegion]
  );

  const makeToggle = (setter: typeof setActiveEFPoints) => (ef: EFScale) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(ef)) next.delete(ef); else next.add(ef);
      if (next.size === 0) return new Set(EF_ORDER);
      return next;
    });
  };
  const toggleEFPoints = makeToggle(setActiveEFPoints);
  const toggleEFLines = makeToggle(setActiveEFLines);

  const setRange = (s: Date, e: Date, exact?: boolean) => {
    if (exact) { setStartDate(s); setEndDate(e); }
    else { setStartDate(startOfDay(s)); setEndDate(endOfDay(e)); }
  };
  const setWarningToggle = (k: WarningKind, v: boolean) =>
    setWarningTogglesState((prev) => ({ ...prev, [k]: v }));

  const warningsCount = useMemo(() => {
    const acc: Record<WarningKind, number> = { svr: 0, destrSvr: 0, tor: 0, pdsTor: 0, torE: 0 };
    for (const w of warnings) acc[w.kind] = (acc[w.kind] ?? 0) + 1;
    return acc;
  }, [warnings]);

  const generateSpc = useCallback(async () => {
    const opt = OUTLOOK_OPTIONS.find((o) => o.key === spcChoice);
    if (!opt) return;
    setSpcLoading(true); setSpcError(null);
    try {
      const r = await fetchSpcOutlook(spcDate, opt.time, opt.kind);
      setOutlook(r); setOutlookDate(spcDate);
    } catch (err: any) {
      setSpcError(err?.message ?? "SPC outlook failed"); setOutlook(null);
    } finally { setSpcLoading(false); }
  }, [spcChoice, spcDate]);

  const clearSpc = () => { setOutlook(null); setOutlookDate(null); setSpcError(null); };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground md:flex-row">
      {sidebarOpen ? (
        <>
          {isMobile && (
            <div
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 z-[850] bg-black/60 md:hidden"
              aria-hidden="true"
            />
          )}
          <div
            className={
              isMobile
                ? "fixed inset-y-0 left-0 z-[860] w-[88vw] max-w-[420px] shrink-0 shadow-2xl md:hidden"
                : "relative hidden shrink-0 md:block"
            }
            style={isMobile ? undefined : { width: sidebarWidth }}
          >
            {mounted ? <DatSidebar
              points={points}
              lines={lines}
              filteredPoints={filteredPoints}
              filteredLines={filteredLines}
              activeEFPoints={activeEFPoints}
              toggleEFPoints={toggleEFPoints}
              activeEFLines={activeEFLines}
              toggleEFLines={toggleEFLines}
              selectedStates={selectedStates}
              setSelectedStates={setSelectedStates}
              selectedExpRegion={selectedExpRegion}
              setSelectedExpRegion={setSelectedExpRegion}
              selectedWfos={selectedWfos}
              setSelectedWfos={setSelectedWfos}
              startDate={startDate}
              endDate={endDate}
              setRange={setRange}
              showPoints={showPoints}
              setShowPoints={setShowPoints}
              showLines={showLines}
              setShowLines={setShowLines}
              loading={loading}
              error={error}
              onRefresh={() => load(startDate, endDate)}
              fetchedAt={data?.fetchedAt ?? null}
              warningToggles={warningToggles}
              setWarningToggle={setWarningToggle}
              warningsLoading={warningsLoading}
              warningsError={warningsError}
              warningsCount={warningsCount}
              warningsCapped={warningsCapped}
              spcDate={spcDate}
              setSpcDate={setSpcDate}
              spcChoice={spcChoice}
              setSpcChoice={setSpcChoice}
              generateSpc={generateSpc}
              spcLoading={spcLoading}
              spcError={spcError}
              clearSpc={clearSpc}
              hasSpc={!!outlook}
              onCollapse={() => setSidebarOpen(false)}
              onOpenSettings={() => setSettingsOpen(true)}
              settings={settings}
            /> : <div className="h-full w-full border-r border-border bg-panel" />}
            {!isMobile && (
              <div
                onMouseDown={onDragStart}
                className="group absolute right-0 top-0 z-[900] flex h-full w-2 -mr-1 cursor-col-resize items-center justify-center"
                title="Drag to resize"
              >
                <div className="h-12 w-1 rounded-full bg-border group-hover:bg-primary/70 transition-colors" />
              </div>
            )}
          </div>
        </>
      ) : (
        <button
          onClick={() => setSidebarOpen(true)}
          className="absolute left-3 top-3 z-[800] inline-flex items-center gap-2 rounded-md border border-border bg-panel px-3 py-2 text-xs font-medium text-foreground shadow-md hover:bg-secondary"
          aria-label="Open sidebar"
        >
          ☰ Open panel
        </button>
      )}

      <main className="relative flex-1">
        {mounted ? (
          <Suspense fallback={<MapSkeleton />}>
            <DatMap
              points={filteredPoints}
              lines={filteredLines}
              showPoints={showPoints}
              showLines={showLines}
              warnings={warnings}
              warningToggles={warningToggles}
              outlook={outlook}
              outlookDate={outlookDate}
              settings={settings}
            />
          </Suspense>
        ) : (
          <MapSkeleton />
        )}

        {(data?.pointsExceeded || data?.linesExceeded) && (
          <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full border border-primary/40 bg-panel/90 px-3 py-1 text-xs text-primary backdrop-blur">
            Result limit reached — narrow the date range for a complete set
          </div>
        )}

        <div className="absolute right-3 top-3 z-[800] flex items-center gap-2">
          {session?.user ? (
            <Button size="sm" variant="secondary" onClick={() => supabase.auth.signOut()} className="h-8 text-xs">
              Sign out
            </Button>
          ) : (
            <Button size="sm" onClick={() => setAuthOpen(true)} className="h-8 text-xs">
              Sign in to sync
            </Button>
          )}
        </div>
      </main>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        setSettings={setSettings}
        reset={resetSettings}
      />
      <AuthDialog open={authOpen} onOpenChange={setAuthOpen} />
      <DisclaimerDialog />
    </div>
  );
}

function MapSkeleton() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-background">
      <div className="text-sm text-muted-foreground">Loading map…</div>
    </div>
  );
}
