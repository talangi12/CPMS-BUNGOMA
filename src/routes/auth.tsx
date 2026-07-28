import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import emblem from "@/assets/bungoma-emblem.png";
import landscape from "@/assets/bungoma-landscape.jpg";
import { resolveLoginEmail, bootstrapDefaultSuperAdmin, resolveLoginDestination } from "@/lib/auth-helpers.functions";
import { requestPasswordResetOtp, confirmPasswordReset } from "@/lib/password-reset.functions";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in — Bungoma CPMS" }, { name: "description", content: "Sign in to the County Government of Bungoma Performance Management System." }] }),
  component: AuthPage,
});

type IdType = "national_id" | "personal_number";

function AuthPage() {
  const resolveFn = useServerFn(resolveLoginEmail);
  const bootstrapFn = useServerFn(bootstrapDefaultSuperAdmin);
  const resolveDestFn = useServerFn(resolveLoginDestination);
  const requestResetFn = useServerFn(requestPasswordResetOtp);
  const confirmResetFn = useServerFn(confirmPasswordReset);

  const [idType, setIdType] = useState<IdType>("national_id");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // Forgot-password dialog state
  const [resetOpen, setResetOpen] = useState(false);
  const [resetStep, setResetStep] = useState<"start" | "verify">("start");
  const [resetIdType, setResetIdType] = useState<IdType>("national_id");
  const [resetIdentifier, setResetIdentifier] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetNewPassword2, setResetNewPassword2] = useState("");
  const [resetExpires, setResetExpires] = useState<string | null>(null);
  const [resetMaskedEmail, setResetMaskedEmail] = useState("");
  const [resetMaskedPhone, setResetMaskedPhone] = useState("");
  const [resetBusy, setResetBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      window.location.href = await resolveDest();
    });
    bootstrapFn({}).catch(() => {});
  }, [bootstrapFn]);

  async function resolveDest(): Promise<string> {
    try {
      const res = await resolveDestFn({});
      return res.path;
    } catch {
      return "/dashboard";
    }
  }

  async function recordEvent(success: boolean, userId: string | null, email: string | null, reason?: string) {
    try {
      await supabase.from("login_events").insert({
        user_id: userId, id_number: identifier.trim() || null, email,
        success, failure_reason: reason ?? null,
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null,
      });
    } catch { /* non-blocking */ }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { email } = await resolveFn({ data: { identifier: identifier.trim() } });
      const { data: signed, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { await recordEvent(false, null, email, error.message); throw error; }
      await recordEvent(true, signed.user?.id ?? null, email);
      const dest = signed.user ? await resolveDest() : "/dashboard";
      window.location.href = dest;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign-in failed");
    } finally { setLoading(false); }
  }

  function openReset() {
    setResetOpen(true); setResetStep("start");
    setResetIdType(idType); setResetIdentifier(identifier);
    setResetCode(""); setResetNewPassword(""); setResetNewPassword2("");
  }

  async function handleResetStart(e: React.FormEvent) {
    e.preventDefault();
    setResetBusy(true);
    try {
      const res = await requestResetFn({ data: { identifier: resetIdentifier.trim() } });
      setResetExpires(res.expires_at);
      setResetMaskedEmail(res.sent_to_email_masked);
      setResetMaskedPhone(res.sent_to_phone_masked);
      setResetStep("verify");
      toast.success(`Reset code (demo): ${res.mock_code}`, { duration: 14000 });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start reset");
    } finally { setResetBusy(false); }
  }

  async function handleResetConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (resetNewPassword !== resetNewPassword2) return toast.error("Passwords do not match");
    setResetBusy(true);
    try {
      await confirmResetFn({ data: { identifier: resetIdentifier.trim(), code: resetCode.trim(), new_password: resetNewPassword } });
      toast.success("Password updated. Sign in with your new password.");
      setResetOpen(false);
      setPassword(resetNewPassword);
      setIdType(resetIdType);
      setIdentifier(resetIdentifier);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reset failed");
    } finally { setResetBusy(false); }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden lg:block">
        <img src={landscape} alt="Bungoma landscape" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-hero opacity-90" />
        <div className="relative flex h-full flex-col justify-between p-12 text-primary-foreground">
          <Link to="/" className="flex items-center gap-3">
            <img src={emblem} alt="" className="h-12 w-12 object-contain" width={48} height={48} />
            <div>
              <div className="font-display text-lg font-bold">Bungoma CPMS</div>
              <div className="text-[11px] uppercase tracking-widest opacity-80">County Government of Bungoma</div>
            </div>
          </Link>
          <div>
            <h2 className="font-display text-4xl font-bold leading-tight text-balance">Performance.<br />Integrity.<br />Service.</h2>
            <p className="mt-4 max-w-md text-primary-foreground/85">Sign in with your National ID or Personal Number — for over 7,000 public servants.</p>
          </div>
          <div className="text-xs opacity-70">© {new Date().getFullYear()} County Government of Bungoma</div>
        </div>
      </div>

      <div className="flex items-center justify-center bg-background p-6 sm:p-10">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <img src={emblem} alt="" className="h-10 w-10 object-contain" width={40} height={40} />
            <div>
              <div className="font-display text-base font-bold text-primary">Bungoma CPMS</div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">County Government of Bungoma</div>
            </div>
          </div>

          <h1 className="font-display text-3xl font-bold">Welcome back</h1>
          <p className="mt-2 text-sm text-muted-foreground">Sign in with your National ID or Personal Number.</p>

          <Card className="mt-6 p-6 shadow-card">
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <Label htmlFor="idtype">Login identifier type</Label>
                <select
                  id="idtype"
                  value={idType}
                  onChange={(e) => setIdType(e.target.value as IdType)}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="national_id">National ID Number</option>
                  <option value="personal_number">Personal Number</option>
                </select>
              </div>
              <div>
                <Label htmlFor="idn">{idType === "national_id" ? "National ID Number" : "Personal Number"}</Label>
                <Input id="idn" required value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder={idType === "national_id" ? "e.g. 12345678" : "e.g. 1234567"} autoComplete="username" />
              </div>
              <div>
                <Label htmlFor="pw">Password</Label>
                <Input id="pw" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
                <div className="mt-1 flex items-center justify-between">
                  <p className="text-[11px] text-muted-foreground">First-time login? Use default <code className="rounded bg-muted px-1 py-0.5">BUNGOMA*039.</code></p>
                  <button type="button" onClick={openReset} className="text-[11px] font-medium text-primary hover:underline">Forgot password?</button>
                </div>
              </div>
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? "Please wait…" : "Sign in"}
              </Button>
            </form>
          </Card>
          <p className="mt-3 text-center text-[11px] text-muted-foreground">Administrators and employees use the same screen — System Admin credentials remain unchanged.</p>
        </div>
      </div>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset your password</DialogTitle>
            <DialogDescription>
              {resetStep === "start" ? "Enter your National ID or Personal Number — a one-time code will be sent to your registered email and phone." : `Code sent to email ${resetMaskedEmail} and phone ${resetMaskedPhone}. Expires ${resetExpires ? new Date(resetExpires).toLocaleTimeString() : "in 5 min"}.`}
            </DialogDescription>
          </DialogHeader>

          {resetStep === "start" ? (
            <form onSubmit={handleResetStart} className="space-y-4">
              <div>
                <Label htmlFor="ridtype">Identifier type</Label>
                <select id="ridtype" value={resetIdType} onChange={(e) => setResetIdType(e.target.value as IdType)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  <option value="national_id">National ID Number</option>
                  <option value="personal_number">Personal Number</option>
                </select>
              </div>
              <div>
                <Label htmlFor="rid">{resetIdType === "national_id" ? "National ID Number" : "Personal Number"}</Label>
                <Input id="rid" required value={resetIdentifier} onChange={(e) => setResetIdentifier(e.target.value)} />
              </div>
              <Button type="submit" disabled={resetBusy} className="w-full">{resetBusy ? "Sending…" : "Send reset code"}</Button>
            </form>
          ) : (
            <form onSubmit={handleResetConfirm} className="space-y-4">
              <div>
                <Label htmlFor="rcode">One-time code</Label>
                <Input id="rcode" required value={resetCode} onChange={(e) => setResetCode(e.target.value)} placeholder="6-digit code" maxLength={6} inputMode="numeric" autoFocus />
              </div>
              <div>
                <Label htmlFor="rnp">New password</Label>
                <Input id="rnp" type="password" required value={resetNewPassword} onChange={(e) => setResetNewPassword(e.target.value)} placeholder="At least 8 chars · upper, lower, digit, symbol" />
              </div>
              <div>
                <Label htmlFor="rnp2">Confirm new password</Label>
                <Input id="rnp2" type="password" required value={resetNewPassword2} onChange={(e) => setResetNewPassword2(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setResetStep("start")} className="w-full">Back</Button>
                <Button type="submit" disabled={resetBusy} className="w-full">{resetBusy ? "Updating…" : "Update password"}</Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
