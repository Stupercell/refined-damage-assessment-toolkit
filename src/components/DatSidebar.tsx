import { useEffect, useMemo, useState } from "react";
import { RefreshCw, ChevronDown, X, CalendarIcon, Loader2, Settings, PanelLeftClose, Search } from "lucide-react";
import { WFO_LIST } from "@/lib/wfo";
import { format } from "date-fns";
import {
  type DamagePoint,
  type DamageLine,
  type EFScale,
  EF_COLORS,
  EF_ORDER,
  ALL_STATES,
  REGIONS,
} from "@/lib/dat";
import { EXPERIMENTAL_REGIONS } from "@/lib/experimental-regions";
import {
  WARNING_LABELS,
  type WarningKind,
} from "@/lib/warnings";
import type { AppSettings } from "@/lib/settings";
import { OUTLOOK_OPTIONS } from "@/lib/spc";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import stupercellProfile from "@/assets/stupercell-profile.jpg";

interface Props {
  points: DamagePoint[];
  lines: DamageLine[];
  filteredPoints: DamagePoint[];
  filteredLines: DamageLine[];
  activeEFPoints: Set<EFScale>;
  toggleEFPoints: (ef: EFScale) => void;
  activeEFLines: Set<EFScale>;
  toggleEFLines: (ef: EFScale) => void;
  selectedStates: Set<string>;
  setSelectedStates: (s: Set<string>) => void;
  selectedExpRegion: string | null;
  setSelectedExpRegion: (r: string | null) => void;
  selectedWfos: Set<string>;
  setSelectedWfos: (s: Set<string>) => void;
  startDate: Date;
  endDate: Date;
  setRange: (start: Date, end: Date, exact?: boolean) => void;
  showPoints: boolean;
  setShowPoints: (b: boolean) => void;
  showLines: boolean;
  setShowLines: (b: boolean) => void;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  fetchedAt: number | null;
  // Warnings
  warningToggles: Record<WarningKind, boolean>;
  setWarningToggle: (k: WarningKind, v: boolean) => void;
  warningsLoading: boolean;
  warningsError: string | null;
  warningsCount: Record<WarningKind, number>;
  warningsCapped: boolean;
  // SPC
  spcDate: Date;
  setSpcDate: (d: Date) => void;
  spcChoice: string;
  setSpcChoice: (s: string) => void;
  generateSpc: () => void;
  spcLoading: boolean;
  spcError: string | null;
  clearSpc: () => void;
  hasSpc: boolean;
  onCollapse: () => void;
  onOpenSettings: () => void;
  settings: AppSettings;
}

const PRESETS: { label: string; days: number }[] = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "1y", days: 365 },
];

export default function DatSidebar(p: Props) {
  const tornadoCount = useMemo(() => {
    const ids = new Set<string>();
    let unnamed = 0;
    for (const ln of p.filteredLines) {
      if (ln.event_id) ids.add(ln.event_id);
      else unnamed++;
    }
    return ids.size + unnamed;
  }, [p.filteredLines]);

  const visibleStates = useMemo(() => {
    const set = new Set<string>();
    for (const pt of p.points) if (pt.state) set.add(pt.state);
    for (const ln of p.lines) if (ln.state) set.add(ln.state);
    return set;
  }, [p.points, p.lines]);

  return (
    <aside className="relative flex h-full w-full flex-col border-r border-border bg-panel text-panel-foreground">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-5 py-4">
        <button
          onClick={p.onOpenSettings}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          aria-label="Settings"
          title="Customization settings"
        >
          <Settings className="h-4 w-4" />
        </button>
        <TooltipProvider delayDuration={120}>
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href="https://x.com/Stupercell"
                target="_blank"
                rel="noreferrer"
                className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-md border border-border bg-secondary transition hover:ring-2 hover:ring-primary/60"
                aria-label="Author - Stupercell"
              >
                <img src={stupercellProfile} alt="Stupercell profile" className="h-full w-full object-cover" />
              </a>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start">Author - Stupercell</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <div className="leading-tight">
          <h1 className="text-sm font-semibold tracking-tight">NWS Damage Assessment</h1>
          <p className="text-xs text-muted-foreground">Live · DamageViewer</p>
        </div>
        <button
          onClick={p.onRefresh}
          disabled={p.loading}
          className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-50"
          aria-label="Refresh"
        >
          <RefreshCw className={cn("h-4 w-4", p.loading && "animate-spin")} />
        </button>
        <button
          onClick={p.onCollapse}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          aria-label="Collapse sidebar"
          title="Hide panel"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      {/* Headline counts */}
      <div className="grid grid-cols-2 gap-px border-b border-border bg-border/60">
        <Stat label="Tornado tracks" value={tornadoCount.toLocaleString()} accent />
        <Stat label="Damage points" value={p.filteredPoints.length.toLocaleString()} />
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto">
        {/* Date range — applies globally except SPC overlays */}
        <Section title="Date range">
          <DateRangeForm
            startDate={p.startDate}
            endDate={p.endDate}
            timeZone={p.settings.timeZone}
            onApply={p.setRange}
          />
          <div className="mt-2 flex flex-wrap gap-1">
            {PRESETS.map((pr) => (
              <button
                key={pr.label}
                onClick={() => {
                  const end = new Date();
                  const start = new Date();
                  start.setDate(start.getDate() - pr.days);
                  p.setRange(start, end);
                }}
                className="rounded-md border border-border bg-secondary px-2 py-1 text-[11px] font-medium hover:bg-muted"
              >
                Last {pr.label}
              </button>
            ))}
            <button
              onClick={() => {
                const y = new Date().getFullYear();
                p.setRange(new Date(y, 0, 1), new Date());
              }}
              className="rounded-md border border-border bg-secondary px-2 py-1 text-[11px] font-medium hover:bg-muted"
            >
              YTD
            </button>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Applies to DAT data and Warnings. SPC Outlooks use their own date.
          </p>
        </Section>

        <Accordion type="multiple" defaultValue={["dat"]} className="px-1">
          {/* DAT Data */}
          <AccordionItem value="dat" className="border-border">
            <AccordionTrigger className="px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:no-underline">
              DAT Data
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-3">
              {/* Layer toggles */}
              <SubLabel>Map layers</SubLabel>
              <ToggleRow
                label="Damage points"
                sub={`${p.filteredPoints.length.toLocaleString()} visible`}
                checked={p.showPoints}
                onChange={p.setShowPoints}
                color="#7ec8ff"
              />
              <ToggleRow
                label="Tornado paths"
                sub={`${p.filteredLines.length.toLocaleString()} segments · ${tornadoCount} tornadoes`}
                checked={p.showLines}
                onChange={p.setShowLines}
                color="#ff8a1f"
              />

              {/* EF filter — Damage points */}
              <SubLabel className="mt-3">Damage point EF filter</SubLabel>
              <EFRow active={p.activeEFPoints} onToggle={p.toggleEFPoints} />

              {/* EF filter — Tornado tracks */}
              <SubLabel className="mt-3">Tornado track EF filter</SubLabel>
              <EFRow active={p.activeEFLines} onToggle={p.toggleEFLines} hideTstm />

              {/* Regions */}
              <SubLabel className="mt-3">Regions</SubLabel>
              <div className="mb-2 flex flex-wrap gap-1">
                {Object.keys(REGIONS).map((r) => (
                  <button
                    key={r}
                    onClick={() => { p.setSelectedExpRegion(null); p.setSelectedStates(new Set(REGIONS[r])); }}
                    className="rounded-md border border-border bg-secondary px-2 py-1 text-[11px] font-medium hover:bg-muted"
                  >
                    {r}
                  </button>
                ))}
                <button
                  onClick={() => { p.setSelectedExpRegion(null); p.setSelectedStates(new Set()); }}
                  className="rounded-md border border-border bg-secondary px-2 py-1 text-[11px] font-medium hover:bg-muted"
                >
                  All
                </button>
              </div>

              {/* Experimental regions */}
              <SubLabel className="mt-3">Experimental Regions (geographic)</SubLabel>
              <Select
                value={p.selectedExpRegion ?? "__none"}
                onValueChange={(v) => {
                  if (v === "__none") p.setSelectedExpRegion(null);
                  else { p.setSelectedStates(new Set()); p.setSelectedExpRegion(v); }
                }}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="__none" className="text-xs">None</SelectItem>
                  {EXPERIMENTAL_REGIONS.map((r) => (
                    <SelectItem key={r.name} value={r.name} className="text-xs">{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* States */}
              <SubLabel className="mt-3">States</SubLabel>
              <StatesPicker
                selected={p.selectedStates}
                onChange={(s) => { if (s.size > 0) p.setSelectedExpRegion(null); p.setSelectedStates(s); }}
                visibleStates={visibleStates}
              />
              {p.selectedStates.size > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {[...p.selectedStates].sort().map((s) => (
                    <span key={s} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px]">
                      {s}
                      <button
                        onClick={() => {
                          const next = new Set(p.selectedStates);
                          next.delete(s);
                          p.setSelectedStates(next);
                        }}
                        className="opacity-60 hover:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* WFOs */}
              <SubLabel className="mt-3">WFO (Forecast Office)</SubLabel>
              <WfoPicker selected={p.selectedWfos} onChange={p.setSelectedWfos} />
              {p.selectedWfos.size > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {[...p.selectedWfos].sort().map((w) => (
                    <span key={w} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px]">
                      {w}
                      <button
                        onClick={() => {
                          const next = new Set(p.selectedWfos); next.delete(w);
                          p.setSelectedWfos(next);
                        }}
                        className="opacity-60 hover:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </AccordionContent>
          </AccordionItem>

          {/* Warnings */}
          <AccordionItem value="warnings" className="border-border">
            <AccordionTrigger className="px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:no-underline">
              Warnings
              {p.warningsLoading && <Loader2 className="ml-2 h-3 w-3 animate-spin" />}
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-3 space-y-1">
              {(["svr", "destrSvr", "tor", "pdsTor", "torE"] as WarningKind[]).map((k) => (
                <ToggleRow
                  key={k}
                  label={WARNING_LABELS[k]}
                  sub={`${(p.warningsCount[k] ?? 0).toLocaleString()} in range`}
                  checked={p.warningToggles[k]}
                  onChange={(v) => p.setWarningToggle(k, v)}
                  color={p.settings.warnings[k]?.color ?? "#888"}
                />
              ))}
              {p.warningsCapped && (
                <div className="rounded-md border border-border bg-secondary/50 p-2 text-[10px] text-muted-foreground">
                  Warnings range capped to last 365 days for performance.
                </div>
              )}
              {p.warningsError && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-[11px] text-destructive-foreground">
                  {p.warningsError}
                </div>
              )}
            </AccordionContent>
          </AccordionItem>

          {/* SPC Outlooks */}
          <AccordionItem value="spc" className="border-border">
            <AccordionTrigger className="px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:no-underline">
              SPC Outlooks
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-3 space-y-2">
              <SubLabel>Outlook date</SubLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="h-8 w-full justify-start text-left text-xs font-normal">
                    <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                    {format(p.spcDate, "PPP")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={p.spcDate}
                    onSelect={(d) => d && p.setSpcDate(d)}
                    captionLayout="dropdown"
                    fromYear={2003}
                    toYear={new Date().getFullYear()}
                    className="pointer-events-auto p-3"
                  />
                </PopoverContent>
              </Popover>

              <SubLabel className="mt-2">Outlook type & issuance</SubLabel>
              <Select value={p.spcChoice} onValueChange={p.setSpcChoice}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {OUTLOOK_OPTIONS.map((o) => (
                    <SelectItem key={o.key} value={o.key} className="text-xs">{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="h-8 flex-1 text-xs"
                  onClick={p.generateSpc}
                  disabled={p.spcLoading}
                >
                  {p.spcLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Generate"}
                </Button>
                {p.hasSpc && (
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={p.clearSpc}>
                    Clear
                  </Button>
                )}
              </div>
              {p.spcError && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-[11px] text-destructive-foreground">
                  {p.spcError}
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {p.error && (
          <div className="m-3 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive-foreground">
            {p.error}
          </div>
        )}
      </div>

      <div className="border-t border-border px-5 py-2 text-[11px] text-muted-foreground">
        <div>
          {p.fetchedAt ? `Updated ${new Date(p.fetchedAt).toLocaleTimeString(undefined, p.settings.timeZone === "utc" ? { timeZone: "UTC" } : {})}${p.settings.timeZone === "utc" ? " UTC" : ""}` : "—"}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
          <span className="text-muted-foreground/70">Sources:</span>
          <a className="text-accent hover:underline" href="https://apps.dat.noaa.gov/StormDamage/DamageViewer/" target="_blank" rel="noreferrer">NWS DAT</a>
          <span>·</span>
          <a className="text-accent hover:underline" href="https://mesonet.agron.iastate.edu/request/gis/watchwarn.phtml" target="_blank" rel="noreferrer">IEM Warnings</a>
          <span>·</span>
          <a className="text-accent hover:underline" href="https://www.spc.noaa.gov/products/outlook/" target="_blank" rel="noreferrer">SPC Outlooks</a>
          <span>·</span>
          <a className="text-accent hover:underline" href="https://mapservices.weather.noaa.gov/static/rest/services/nws_reference_maps/nws_reference_map/MapServer" target="_blank" rel="noreferrer">NWS Reference Maps (WFO)</a>
          <span>·</span>
          <a className="text-accent hover:underline" href="https://github.com/topojson/us-atlas" target="_blank" rel="noreferrer">US Atlas (counties/states)</a>
        </div>
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border px-5 py-3">
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

function SubLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground", className)}>
      {children}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-panel px-3 py-3">
      <div className={cn("text-2xl font-semibold tabular-nums", accent && "text-primary")}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function ToggleRow({
  label, sub, checked, onChange, color,
}: {
  label: string; sub: string; checked: boolean;
  onChange: (b: boolean) => void; color: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-md py-1.5">
      <span className="block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      <div className="flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-[11px] text-muted-foreground">{sub}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function EFRow({
  active, onToggle, hideTstm = false,
}: { active: Set<EFScale>; onToggle: (ef: EFScale) => void; hideTstm?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-1 sm:grid-cols-5">
      {EF_ORDER.filter((ef) => !(hideTstm && ef === "TSTM")).map((ef) => {
        const on = active.has(ef);
        return (
          <button
            key={ef}
            onClick={() => onToggle(ef)}
            className={cn(
              "flex flex-col items-center gap-1 rounded-md border px-1 py-1.5 text-[10px] font-bold transition",
              on ? "border-border bg-secondary" : "border-transparent bg-transparent opacity-40 hover:opacity-70"
            )}
          >
            <span className="block h-3 w-3 rounded-full" style={{ background: EF_COLORS[ef] }} />
            <span>{ef === "TSTM" ? "TSTM" : ef}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---- Date range form: two calendars + Apply ----

function DateRangeForm({
  startDate, endDate, timeZone, onApply,
}: {
  startDate: Date;
  endDate: Date;
  timeZone: AppSettings["timeZone"];
  onApply: (start: Date, end: Date, exact?: boolean) => void;
}) {
  const [from, setFrom] = useState<Date>(startDate);
  const [to, setTo] = useState<Date>(endDate);
  const [fromTime, setFromTime] = useState<string>(toHM(startDate, timeZone));
  const [toTime, setToTime] = useState<string>(toHM(endDate, timeZone));

  useEffect(() => { setFrom(startDate); setFromTime(toHM(startDate, timeZone)); }, [startDate, timeZone]);
  useEffect(() => { setTo(endDate); setToTime(toHM(endDate, timeZone)); }, [endDate, timeZone]);

  const sameDay = sameYMD(from, to, timeZone);

  const dirty =
    from.getTime() !== startDate.getTime() ||
    to.getTime() !== endDate.getTime() ||
    (sameDay && (fromTime !== toHM(startDate, timeZone) || toTime !== toHM(endDate, timeZone)));

  const apply = () => {
    if (sameDay) {
      const [fh, fm] = parseHM(fromTime);
      const [th, tm] = parseHM(toTime);
      const s = withHM(from, fh, fm, 0, 0, timeZone);
      const e = withHM(to, th, tm, 59, 999, timeZone);
      if (e < s) onApply(e, s, true); else onApply(s, e, true);
    } else {
      if (to < from) onApply(to, from); else onApply(from, to);
    }
  };

  const maxYear = new Date().getFullYear();

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <CalPick label="From" value={from} onChange={setFrom} maxYear={maxYear} align="start" timeZone={timeZone} />
        <CalPick label="To"   value={to}   onChange={setTo}   maxYear={maxYear} align="end" timeZone={timeZone} />
      </div>
      {sameDay && (
        <div className="grid grid-cols-2 gap-2">
          <TimePick label="From time" value={fromTime} onChange={setFromTime} timeZone={timeZone} />
          <TimePick label="To time"   value={toTime}   onChange={setToTime} timeZone={timeZone} />
        </div>
      )}
      <Button onClick={apply} disabled={!dirty} size="sm" className="h-8 w-full text-xs">
        Apply {sameDay ? "date & time" : "date range"}
      </Button>
    </div>
  );
}

function toHM(d: Date, timeZone: AppSettings["timeZone"]): string {
  const h = timeZone === "utc" ? d.getUTCHours() : d.getHours();
  const m = timeZone === "utc" ? d.getUTCMinutes() : d.getMinutes();
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function withHM(d: Date, h: number, m: number, s: number, ms: number, timeZone: AppSettings["timeZone"]): Date {
  const x = new Date(d);
  if (timeZone === "utc") x.setUTCHours(h, m, s, ms);
  else x.setHours(h, m, s, ms);
  return x;
}
function ymdParts(d: Date, timeZone: AppSettings["timeZone"]): [number, number, number] {
  return timeZone === "utc"
    ? [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()]
    : [d.getFullYear(), d.getMonth(), d.getDate()];
}
function sameYMD(a: Date, b: Date, timeZone: AppSettings["timeZone"]) {
  const [ay, am, ad] = ymdParts(a, timeZone);
  const [by, bm, bd] = ymdParts(b, timeZone);
  return ay === by && am === bm && ad === bd;
}
function formatCalendarLabel(d: Date, timeZone: AppSettings["timeZone"]): string {
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(timeZone === "utc" ? { timeZone: "UTC" } : {}),
  });
}
function parseHM(s: string): [number, number] {
  const [h, m] = s.split(":").map((x) => parseInt(x, 10));
  return [Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0];
}
function TimePick({
  label, value, onChange, timeZone,
}: { label: string; value: string; onChange: (v: string) => void; timeZone: AppSettings["timeZone"] }) {
  const utc = timeZone === "utc";
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}{utc ? " (UTC)" : ""}</div>
      <input
        type={utc ? "text" : "time"}
        inputMode={utc ? "numeric" : undefined}
        pattern={utc ? "[0-2][0-9]:[0-5][0-9]" : undefined}
        placeholder={utc ? "HH:MM" : undefined}
        maxLength={utc ? 5 : undefined}
        value={value}
        onChange={(e) => onChange(utc ? e.target.value.replace(/[^0-9:]/g, "").slice(0, 5) : e.target.value)}
        className="h-8 w-full rounded-md border border-border bg-input px-2 text-xs"
      />
    </div>
  );
}

function CalPick({
  label, value, onChange, maxYear, align = "start", timeZone,
}: {
  label: string;
  value: Date;
  onChange: (d: Date) => void;
  maxYear: number;
  align?: "start" | "center" | "end";
  timeZone: AppSettings["timeZone"];
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="h-8 w-full justify-start text-left text-xs font-normal">
            <CalendarIcon className="mr-2 h-3.5 w-3.5 opacity-60" />
            {formatCalendarLabel(value, timeZone)}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="z-[2000] w-auto p-0" align={align} side="bottom" sideOffset={6} collisionPadding={12} avoidCollisions>
          <Calendar
            mode="single"
            selected={value}
            onSelect={(d) => d && onChange(d)}
            captionLayout="dropdown"
            fromYear={1950}
            toYear={maxYear}
            defaultMonth={value}
            className="pointer-events-auto p-3"
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function StatesPicker({
  selected, onChange, visibleStates,
}: {
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
  visibleStates: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const ql = q.toLowerCase();
    return ALL_STATES.filter((s) => s.toLowerCase().includes(ql));
  }, [q]);

  const label =
    selected.size === 0
      ? "All states"
      : selected.size === 1
        ? [...selected][0]
        : `${selected.size} states selected`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-between text-xs font-normal">
          {label}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-2" align="start">
        <Input
          autoFocus
          placeholder="Search states…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="mb-2 h-8 text-xs"
        />
        <div className="max-h-64 overflow-y-auto pr-1">
          {list.map((s) => {
            const on = selected.has(s);
            const inData = visibleStates.has(s);
            return (
              <label
                key={s}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-secondary",
                  !inData && "opacity-50"
                )}
              >
                <Checkbox
                  checked={on}
                  onCheckedChange={() => {
                    const next = new Set(selected);
                    if (on) next.delete(s); else next.add(s);
                    onChange(next);
                  }}
                />
                <span className="flex-1">{s}</span>
                {inData && <span className="text-[10px] text-muted-foreground">●</span>}
              </label>
            );
          })}
          {list.length === 0 && (
            <div className="p-3 text-center text-xs text-muted-foreground">No matches</div>
          )}
        </div>
        {selected.size > 0 && (
          <button
            onClick={() => onChange(new Set())}
            className="mt-2 w-full rounded border border-border bg-secondary py-1 text-xs hover:bg-muted"
          >
            Clear selection
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function WfoPicker({
  selected, onChange,
}: { selected: Set<string>; onChange: (s: Set<string>) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const ql = q.toLowerCase().trim();
    if (!ql) return WFO_LIST;
    return WFO_LIST.filter(
      (w) =>
        w.id.toLowerCase().includes(ql) ||
        w.name.toLowerCase().includes(ql) ||
        w.state.toLowerCase().includes(ql)
    );
  }, [q]);
  const label =
    selected.size === 0 ? "All WFOs"
    : selected.size === 1 ? [...selected][0]
    : `${selected.size} WFOs selected`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-between text-xs font-normal">
          {label}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-2" align="start">
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            placeholder="Search by code, city, or state…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-8 pl-7 text-xs"
          />
        </div>
        <div className="max-h-64 overflow-y-auto pr-1">
          {list.map((w) => {
            const on = selected.has(w.id);
            return (
              <label key={w.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-secondary">
                <Checkbox
                  checked={on}
                  onCheckedChange={() => {
                    const next = new Set(selected);
                    if (on) next.delete(w.id); else next.add(w.id);
                    onChange(next);
                  }}
                />
                <span className="font-mono w-10">{w.id}</span>
                <span className="flex-1 truncate">{w.name}</span>
                <span className="text-[10px] text-muted-foreground">{w.state}</span>
              </label>
            );
          })}
          {list.length === 0 && (
            <div className="p-3 text-center text-xs text-muted-foreground">No matches</div>
          )}
        </div>
        {selected.size > 0 && (
          <button
            onClick={() => onChange(new Set())}
            className="mt-2 w-full rounded border border-border bg-secondary py-1 text-xs hover:bg-muted"
          >
            Clear selection
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
