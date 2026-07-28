import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useRoles, hasAnyRole } from "@/hooks/useRoles";
import { RefreshCw, ShieldCheck, Clock, Database } from "lucide-react";
import { getSyncStatus, updateSyncSchedule, triggerPayrollSyncNow } from "@/lib/sync.functions";

export const Route = createFileRoute("/_authenticated/admin/sync")({
  head: () => ({ meta: [{ title: "Payroll Sync — Bungoma CPMS" }] }),
  component: SyncPage,
});

function SyncPage() {
  const { user } = Route.useRouteContext();
  const { data: roles, isLoading } = useRoles(user.id);
  const allowed = hasAnyRole(roles, ["system_admin", "super_admin", "hr"]);
  const status = useServerFn(getSyncStatus);
  const save = useServerFn(updateSyncSchedule);
  const runNow = useServerFn(triggerPayrollSyncNow);

  const { data, refetch } = useQuery({
    queryKey: ["sync-status"], enabled: allowed,
    queryFn: () => status(),
  });

  const [freq, setFreq] = useState<"manual" | "daily" | "weekly">("manual");
  const [endpoint, setEndpoint] = useState("");
  const [payload, setPayload] = useState('{"records":[{"id_number":"12345678","full_name":"Sample Employee","personal_number":"1234567","department":"Health","employment_status":"active"}]}');
  const [busy, setBusy] = useState(false);

  // hydrate from server once
  if (data?.schedule && freq === "manual" && data.schedule.frequency !== "manual" && endpoint === "") {
    setFreq(data.schedule.frequency as "daily" | "weekly");
    setEndpoint(data.schedule.endpoint_url ?? "");
  }

  async function onSave() {
    setBusy(true);
    try { await save({ data: { frequency: freq, endpoint_url: endpoint || undefined } }); toast.success("Schedule saved"); await refetch(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Save failed"); }
    finally { setBusy(false); }
  }

  async function onRunNow() {
    setBusy(true);
    try {
      const parsed = JSON.parse(payload);
      const res = await runNow({ data: { records: parsed.records ?? [] } });
      toast.success(`Sync complete — created ${res.created}, updated ${res.updated}, failed ${res.failed}`);
      await refetch();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Sync failed"); }
    finally { setBusy(false); }
  }

  if (!isLoading && !allowed) {
    return (
      <div className="min-h-screen bg-background"><AppHeader authenticated userId={user.id} />
        <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <Card className="p-10 text-center"><ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground" />
            <h1 className="mt-3 font-display text-2xl font-bold">Admins only</h1>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader authenticated userId={user.id} />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="text-xs font-semibold uppercase tracking-widest text-primary">Administration</div>
        <h1 className="mt-2 font-display text-3xl font-bold flex items-center gap-2"><Database className="h-7 w-7 text-primary" /> Payroll synchronization</h1>
        <p className="mt-1 text-sm text-muted-foreground">Configure automatic sync cadence, run an ad-hoc sync, and inspect sync history.</p>

        <Card className="mt-6 p-5">
          <h2 className="font-display text-sm font-bold flex items-center gap-2"><Clock className="h-4 w-4 text-primary" /> Schedule</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Frequency</Label>
              <Select value={freq} onValueChange={(v) => setFreq(v as "manual" | "daily" | "weekly")}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual only</SelectItem>
                  <SelectItem value="daily">Daily (02:00 EAT)</SelectItem>
                  <SelectItem value="weekly">Weekly (Sun 02:00 EAT)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Payroll endpoint URL (optional)</Label>
              <input className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={endpoint} onChange={(e) => setEndpoint(e.target.value)}
                placeholder="https://payroll.bungoma.go.ke/api/employees" />
            </div>
          </div>
          <div className="mt-3 flex justify-end"><Button onClick={onSave} disabled={busy}>Save schedule</Button></div>
          {data?.schedule?.last_run_at && (
            <div className="mt-2 text-xs text-muted-foreground">Last run: {new Date(data.schedule.last_run_at).toLocaleString()}</div>
          )}
        </Card>

        <Card className="mt-6 p-5">
          <h2 className="font-display text-sm font-bold flex items-center gap-2"><RefreshCw className="h-4 w-4 text-primary" /> Sync now</h2>
          <p className="mt-1 text-xs text-muted-foreground">Paste a JSON payload of records (same shape as the /api/public/payroll-sync endpoint). The records will be upserted into the database and an entry added to sync logs.</p>
          <Textarea rows={8} className="mt-2 font-mono text-xs" value={payload} onChange={(e) => setPayload(e.target.value)} />
          <div className="mt-3 flex justify-end"><Button onClick={onRunNow} disabled={busy}><RefreshCw className="mr-1.5 h-4 w-4" /> Run sync now</Button></div>
        </Card>

        <Card className="mt-6 p-5">
          <h2 className="font-display text-sm font-bold">Recent sync runs</h2>
          <div className="mt-3 max-h-96 overflow-y-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-left uppercase tracking-wider">
                <tr><th className="px-2 py-1.5">Started</th><th>Source</th><th>Status</th><th>Created</th><th>Updated</th><th>Errors</th></tr>
              </thead>
              <tbody>
                {(data?.logs ?? []).map((l) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="px-2 py-1.5">{new Date(l.started_at).toLocaleString()}</td>
                    <td>{l.source}</td>
                    <td><Badge variant={l.status === "success" ? "default" : l.status === "partial" ? "secondary" : l.status === "running" ? "outline" : "destructive"}>{l.status}</Badge></td>
                    <td>{l.created}</td><td>{l.updated}</td><td>{l.errors}</td>
                  </tr>
                ))}
                {(!data?.logs || data.logs.length === 0) && <tr><td colSpan={6} className="px-2 py-4 text-center text-muted-foreground">No sync runs yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </main>
    </div>
  );
}
