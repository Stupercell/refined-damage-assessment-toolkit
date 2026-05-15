import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

const KEY = "dat-disclaimer-dismissed";

export default function DisclaimerDialog() {
  const [open, setOpen] = useState(false);
  const [neverShow, setNeverShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (window.localStorage.getItem(KEY) !== "1") setOpen(true);
    } catch { setOpen(true); }
  }, []);

  const close = () => {
    if (neverShow) {
      try { window.localStorage.setItem(KEY, "1"); } catch {}
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent className="z-[1200] w-[92vw] max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="uppercase tracking-wide">⚠️ HEADS UP — UNOFFICIAL AI-BUILT VIEWER ⚠️</DialogTitle>
          <DialogDescription className="space-y-2 pt-1 text-sm leading-relaxed">
            <span className="block">
              This site was built using AI assistance and bugs may occur. It is{" "}
              <span className="font-semibold text-foreground">NOT</span> an official NOAA or
              National Weather Service product.
            </span>
            <span className="block">
              All damage data is pulled directly from the NWS Damage Assessment Toolkit
              (DAT). Always defer to official NWS sources for warnings and decision-making.
            </span>
          </DialogDescription>
        </DialogHeader>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox checked={neverShow} onCheckedChange={(v) => setNeverShow(!!v)} />
          Never show this message again
        </label>
        <div className="flex justify-end">
          <Button onClick={close}>I understand</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
