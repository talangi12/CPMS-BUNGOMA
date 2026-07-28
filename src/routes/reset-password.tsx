import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

const emblem = "/emblem.svg";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Reset password — Bungoma CPMS" }] }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Supabase auto-creates a recovery session from the URL hash.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((evt) => {
      if (evt === "PASSWORD_RECOVERY" || evt === "SIGNED_IN") setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return toast.error("Passwords do not match");
    if (password.length < 8) return toast.error("Password must be at least 8 characters");
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      try { await supabase.rpc("log_audit", { _action: "password_reset", _entity_type: "auth" }); } catch { /* non-fatal */ }
      toast.success("Password updated. Please sign in.");
      await supabase.auth.signOut();
      navigate({ to: "/auth", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 flex items-center gap-3">
          <img src={emblem} alt="" className="h-10 w-10 object-contain" />
          <div>
            <div className="font-display text-base font-bold text-primary">Bungoma CPMS</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">County Government of Bungoma</div>
          </div>
        </Link>
        <h1 className="font-display text-3xl font-bold">Set a new password</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {ready ? "Enter your new password below." : "Verifying your reset link…"}
        </p>
        <Card className="mt-6 p-6">
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="pw">New password</Label>
              <Input id="pw" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} disabled={!ready} />
            </div>
            <div>
              <Label htmlFor="pw2">Confirm new password</Label>
              <Input id="pw2" type="password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={!ready} />
            </div>
            <Button type="submit" disabled={!ready || busy} className="w-full">
              {busy ? "Updating…" : "Update password"}
            </Button>
          </form>
        </Card>
        <p className="mt-4 text-center text-sm">
          <Link to="/auth" className="font-medium text-primary hover:underline">← Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
