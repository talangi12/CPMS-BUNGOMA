import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { changeOwnPassword } from "@/lib/auth-helpers.functions";
import { getPortalRouteForRoles } from "@/lib/authGuard";

export const Route = createFileRoute("/_authenticated/change-password")({
  head: () => ({ meta: [{ title: "Change password — Bungoma CPMS" }] }),
  component: ChangePasswordPage,
});

const COMPLEXITY = [
  { label: "At least 8 characters", test: (s: string) => s.length >= 8 },
  { label: "An uppercase letter (A-Z)", test: (s: string) => /[A-Z]/.test(s) },
  { label: "A lowercase letter (a-z)", test: (s: string) => /[a-z]/.test(s) },
  { label: "A digit (0-9)", test: (s: string) => /\d/.test(s) },
  { label: "A symbol (!@#$…)", test: (s: string) => /[^A-Za-z0-9]/.test(s) },
];

function ChangePasswordPage() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const changeFn = useServerFn(changeOwnPassword);
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const checks = COMPLEXITY.map((c) => ({ ...c, ok: c.test(pwd) }));
  const allOk = checks.every((c) => c.ok);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pwd !== confirm) return toast.error("Passwords do not match");
    if (!allOk) return toast.error("Password does not meet complexity requirements");
    setBusy(true);
    try {
      await changeFn({ data: { new_password: pwd } });
      toast.success("Password updated.");
      const { data: rr } = await import("@/integrations/supabase/client").then(m => m.supabase.from("user_roles").select("role").eq("user_id", user.id));
      const dest = getPortalRouteForRoles((rr ?? []).map((row: { role?: string | null }) => row.role));
      navigate({ to: dest, replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader authenticated userId={user.id} />
      <main className="mx-auto max-w-md px-4 py-12 sm:px-6">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-primary">Account</div>
          <h1 className="mt-2 font-display text-3xl font-bold flex items-center gap-2"><KeyRound className="h-7 w-7 text-primary" /> Change password</h1>
          <p className="mt-1 text-sm text-muted-foreground">For security, please choose a new password.</p>
        </div>
        <Card className="mt-6 p-6">
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="np">New password</Label>
              <Input id="np" type="password" required minLength={8} value={pwd} onChange={(e) => setPwd(e.target.value)} />
            </div>
            <ul className="space-y-1 rounded-md border border-border bg-muted/30 p-3 text-xs">
              {checks.map((c) => (
                <li key={c.label} className={c.ok ? "text-emerald-700" : "text-muted-foreground"}>
                  <span className="mr-1.5">{c.ok ? "✓" : "○"}</span>{c.label}
                </li>
              ))}
            </ul>
            <div>
              <Label htmlFor="cp">Confirm password</Label>
              <Input id="cp" type="password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            <Button type="submit" disabled={busy || !allOk || pwd !== confirm} className="w-full">{busy ? "Saving…" : "Update password"}</Button>
          </form>
        </Card>
      </main>
    </div>
  );
}
