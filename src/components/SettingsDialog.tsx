import { useEffect, useState } from "react";
import { HexColorPicker } from "react-colorful";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type AppSettings, BASEMAP_OPTIONS } from "@/lib/settings";
import { WARNING_LABELS, type WarningKind } from "@/lib/warnings";

const TAB_OPTIONS = [
  { value: "basemap", label: "General" },
  { value: "labels", label: "Labels" },
  { value: "warnings", label: "Warnings" },
  { value: "spc", label: "SPC Outlooks" },
  { value: "admin", label: "State / County / WFO" },
];

interface Props {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  settings: AppSettings;
  setSettings: (s: AppSettings) => void;
  reset: () => void;
}

export default function SettingsDialog({ open, onOpenChange, settings, setSettings, reset }: Props) {
  const update = (patch: Partial<AppSettings>) => setSettings({ ...settings, ...patch });
  const updateWarn = (k: WarningKind, patch: Partial<AppSettings["warnings"][WarningKind]>) =>
    setSettings({ ...settings, warnings: { ...settings.warnings, [k]: { ...settings.warnings[k], ...patch } } });

  const [tab, setTab] = useState<string>("basemap");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[1100] max-h-[88vh] w-[92vw] max-w-[640px] overflow-y-auto p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>Customization Settings</DialogTitle>
          <DialogDescription>
            Saved automatically. Sign in to sync these across all your devices.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="px-6 py-4">
          {/* Mobile: dropdown selector */}
          <div className="mb-4 md:hidden">
            <Select value={tab} onValueChange={setTab}>
              <SelectTrigger className="h-9 w-full text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TAB_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* Desktop: tab list */}
          <TabsList className="mb-4 hidden w-full flex-wrap justify-start gap-1 md:flex">
            {TAB_OPTIONS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
            ))}
          </TabsList>

          {/* BASEMAP */}
          <TabsContent value="basemap" className="space-y-4">
            <div className="space-y-2">
              <Label>Basemap tile style</Label>
              <Select value={settings.basemap} onValueChange={(v) => update({ basemap: v as any })}>
                <SelectTrigger className="h-9 max-w-md text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BASEMAP_OPTIONS.map((b) => (
                    <SelectItem key={b.key} value={b.key}>{b.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Theme</Label>
              <Select value={settings.theme} onValueChange={(v) => update({ theme: v as any })}>
                <SelectTrigger className="h-9 max-w-md text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="dark">Dark mode</SelectItem>
                  <SelectItem value="light">Light mode</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">Affects all UI panels, dialogs and popovers. Base map tiles are unchanged — pick a basemap above to match.</p>
            </div>
            <div className="space-y-2">
              <Label>Time display</Label>
              <Select value={settings.timeZone} onValueChange={(v) => update({ timeZone: v as any })}>
                <SelectTrigger className="h-9 max-w-md text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">Local time (your timezone)</SelectItem>
                  <SelectItem value="utc">UTC (Zulu)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">Applies to every time/date shown across the site.</p>
            </div>
          </TabsContent>

          {/* LABELS */}
          <TabsContent value="labels" className="space-y-4">
            <div className="rounded-md border border-border p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">City labels</div>
                <Switch
                  checked={settings.cityLabels.enabled}
                  onCheckedChange={(v) => update({ cityLabels: { ...settings.cityLabels, enabled: v } })}
                />
              </div>
              <div>
                <span className="text-[11px] text-muted-foreground">Density (1 = major cities only · 5 = all small towns)</span>
                <Slider
                  value={[settings.cityLabels.density]}
                  min={1} max={5} step={1}
                  onValueChange={(x) => update({ cityLabels: { ...settings.cityLabels, density: Math.round(x[0]) as any } })}
                />
                <div className="mt-1 text-[10px] text-muted-foreground">Current: {settings.cityLabels.density} / 5</div>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <SliderRow label={`Font size ${settings.cityLabels.fontSize}px`} value={settings.cityLabels.fontSize} min={8} max={24} step={1} onChange={(v) => update({ cityLabels: { ...settings.cityLabels, fontSize: Math.round(v) } })} />
                <SliderRow label={`Outline width ${settings.cityLabels.outlineWidth}px`} value={settings.cityLabels.outlineWidth} min={0} max={6} step={0.5} onChange={(v) => update({ cityLabels: { ...settings.cityLabels, outlineWidth: v } })} />
                <ColorRow label="Text color" value={settings.cityLabels.color} onChange={(v) => update({ cityLabels: { ...settings.cityLabels, color: v } })} />
                <ColorRow label="Outline color" value={settings.cityLabels.outlineColor} onChange={(v) => update({ cityLabels: { ...settings.cityLabels, outlineColor: v } })} />
              </div>
            </div>

            <div className="rounded-md border border-border p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">State labels</div>
                <Switch
                  checked={settings.stateLabels.enabled}
                  onCheckedChange={(v) => update({ stateLabels: { ...settings.stateLabels, enabled: v } })}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <SliderRow label={`Font size ${settings.stateLabels.fontSize}px`} value={settings.stateLabels.fontSize} min={10} max={32} step={1} onChange={(v) => update({ stateLabels: { ...settings.stateLabels, fontSize: Math.round(v) } })} />
                <SliderRow label={`Outline width ${settings.stateLabels.outlineWidth}px`} value={settings.stateLabels.outlineWidth} min={0} max={6} step={0.5} onChange={(v) => update({ stateLabels: { ...settings.stateLabels, outlineWidth: v } })} />
                <ColorRow label="Text color" value={settings.stateLabels.color} onChange={(v) => update({ stateLabels: { ...settings.stateLabels, color: v } })} />
                <ColorRow label="Outline color" value={settings.stateLabels.outlineColor} onChange={(v) => update({ stateLabels: { ...settings.stateLabels, outlineColor: v } })} />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">Labels render above all other layers and automatically adjust as you zoom.</p>
          </TabsContent>

          {/* WARNINGS */}
          <TabsContent value="warnings" className="space-y-4">
            {(Object.keys(settings.warnings) as WarningKind[]).map((k) => {
              const w = settings.warnings[k];
              return (
                <div key={k} className="rounded-md border border-border p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="block h-3 w-3 rounded-sm" style={{ background: w.color }} />
                    <div className="text-sm font-medium">{WARNING_LABELS[k]}</div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <ColorRow label="Color" value={w.color} onChange={(v) => updateWarn(k, { color: v })} />
                    <SliderRow label={`Border ${w.weight.toFixed(1)} px`} value={w.weight} min={0} max={6} step={0.1} onChange={(v) => updateWarn(k, { weight: v })} />
                    <SliderRow label={`Fill opacity ${(w.fillOpacity * 100).toFixed(0)}%`} value={w.fillOpacity} min={0} max={1} step={0.02} onChange={(v) => updateWarn(k, { fillOpacity: v })} />
                  </div>
                </div>
              );
            })}
          </TabsContent>

          {/* SPC */}
          <TabsContent value="spc" className="space-y-3">
            <SliderRow label={`Border thickness ${settings.spc.weight.toFixed(1)} px`} value={settings.spc.weight} min={0} max={6} step={0.1} onChange={(v) => update({ spc: { ...settings.spc, weight: v } })} />
            <SliderRow label={`Border opacity ${(settings.spc.strokeOpacity * 100).toFixed(0)}%`} value={settings.spc.strokeOpacity} min={0} max={1} step={0.02} onChange={(v) => update({ spc: { ...settings.spc, strokeOpacity: v } })} />
            <SliderRow label={`Fill opacity ${(settings.spc.fillOpacity * 100).toFixed(0)}%`} value={settings.spc.fillOpacity} min={0} max={1} step={0.02} onChange={(v) => update({ spc: { ...settings.spc, fillOpacity: v } })} />
            <div className="space-y-2 rounded-md border border-border p-3">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">SIG / CIG hatching</div>
              <p className="text-[11px] text-muted-foreground">Each level has its own border color & thickness — matches the SPC intensity legend.</p>
              {(["SIG", "CIG1", "CIG2", "CIG3"] as const).map((k) => {
                const entry = settings.spc.sig[k];
                if (!entry) return null;
                return (
                  <div key={k} className="grid grid-cols-1 items-end gap-3 md:grid-cols-2">
                    <ColorRow label={`${k} color`} value={entry.color} onChange={(v) => update({ spc: { ...settings.spc, sig: { ...settings.spc.sig, [k]: { ...entry, color: v } } } })} />
                    <SliderRow label={`${k} thickness ${entry.weight.toFixed(1)} px`} value={entry.weight} min={0} max={6} step={0.1} onChange={(v) => update({ spc: { ...settings.spc, sig: { ...settings.spc.sig, [k]: { ...entry, weight: v } } } })} />
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">SPC fills use the official SPC color for each category. You control opacity and border thickness here.</p>
          </TabsContent>

          {/* ADMIN LINES */}
          <TabsContent value="admin" className="space-y-4">
            <AdminLineEditor
              title="State borders"
              s={settings.states}
              onChange={(v) => update({ states: v })}
            />
            <AdminLineEditor
              title="County borders"
              s={settings.counties}
              onChange={(v) => update({ counties: v })}
              dashedToggle
            />
            <AdminLineEditor
              title="WFO (County Warning Area) borders"
              s={settings.wfo}
              onChange={(v) => update({ wfo: v })}
            />
            <p className="text-[11px] text-muted-foreground">Counties and WFOs are heavy — toggle off if the map feels sluggish.</p>
          </TabsContent>
        </Tabs>

        <div className="flex justify-between gap-2 border-t border-border px-6 py-3">
          <Button variant="ghost" size="sm" onClick={reset}>Reset to defaults</Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{children}</div>;
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  useEffect(() => setDraft(value), [value]);
  const commit = (v: string) => { if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v); };
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Pick color"
              className="h-8 w-12 cursor-pointer rounded border border-border"
              style={{ background: value }}
            />
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2" sideOffset={6}>
            <HexColorPicker color={value} onChange={onChange} />
          </PopoverContent>
        </Popover>
        <input type="text" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => commit(draft)} onKeyDown={(e) => { if (e.key === "Enter") commit(draft); }} className="h-8 w-28 rounded border border-border bg-input px-2 text-xs" />
      </div>
    </div>
  );
}

function SliderRow({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  const v = Number.isFinite(value) ? value : min;
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <Slider value={[v]} min={min} max={max} step={step} onValueChange={(x) => onChange(x[0])} />
    </label>
  );
}

function AdminLineEditor({
  title, s, onChange, dashedToggle,
}: {
  title: string;
  s: { enabled: boolean; color: string; weight: number; dashed?: boolean };
  onChange: (v: any) => void;
  dashedToggle?: boolean;
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-medium">{title}</div>
        <Switch checked={s.enabled} onCheckedChange={(v) => onChange({ ...s, enabled: v })} />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <ColorRow label="Color" value={s.color} onChange={(v) => onChange({ ...s, color: v })} />
        <SliderRow label={`Thickness ${s.weight.toFixed(1)} px`} value={s.weight} min={0.1} max={6} step={0.1} onChange={(v) => onChange({ ...s, weight: v })} />
        {dashedToggle && (
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Style</span>
            <Select value={s.dashed ? "dashed" : "solid"} onValueChange={(v) => onChange({ ...s, dashed: v === "dashed" })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="solid">Solid</SelectItem>
                <SelectItem value="dashed">Dashed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </div>
  );
}
