import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";

interface Props {
  open: boolean;
  onOpenChange: (b: boolean) => void;
}

export default function AuthDialog({ open, onOpenChange }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<null | "google" | "in" | "up">(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const wrap = async (k: "google" | "in" | "up", fn: () => Promise<void>) => {
    setBusy(k); setErr(null); setInfo(null);
    try { await fn(); } catch (e: any) { setErr(e?.message ?? "Something went wrong"); }
    finally { setBusy(null); }
  };

  const google = () => wrap("google", async () => {
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (r.error) throw r.error;
    if (!r.redirected) onOpenChange(false);
  });

  const signIn = () => wrap("in", async () => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    onOpenChange(false);
  });

  const signUp = () => wrap("up", async () => {
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) throw error;
    setInfo("Account created — you may need to confirm your email before signing in.");
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[1100] w-[92vw] max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Sign in to sync settings</DialogTitle>
          <DialogDescription>
            Sync your customizations across devices. We don't email you or share your address.
          </DialogDescription>
        </DialogHeader>

        <Button type="button" variant="secondary" onClick={google} disabled={!!busy} className="w-full">
          {busy === "google" ? "Opening Google…" : "Continue with Google"}
        </Button>

        <div className="my-2 flex items-center gap-2 text-[11px] uppercase text-muted-foreground">
          <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
        </div>

        <Tabs defaultValue="signin">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="signin">Sign in</TabsTrigger>
            <TabsTrigger value="signup">Sign up</TabsTrigger>
          </TabsList>
          <TabsContent value="signin" className="space-y-2 pt-3">
            <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <Button onClick={signIn} disabled={!!busy || !email || !password} className="w-full">
              {busy === "in" ? "Signing in…" : "Sign in"}
            </Button>
          </TabsContent>
          <TabsContent value="signup" className="space-y-2 pt-3">
            <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input type="password" placeholder="Password (min 6 chars)" value={password} onChange={(e) => setPassword(e.target.value)} />
            <Button onClick={signUp} disabled={!!busy || !email || password.length < 6} className="w-full">
              {busy === "up" ? "Creating account…" : "Create account"}
            </Button>
          </TabsContent>
        </Tabs>

        {err && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</div>}
        {info && <div className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">{info}</div>}
      </DialogContent>
    </Dialog>
  );
}
