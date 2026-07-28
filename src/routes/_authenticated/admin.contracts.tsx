import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useRoles, hasAnyRole } from "@/hooks/useRoles";
import { contractAction, runMaintenance } from "@/lib/status.functions";
import { FileWarning, RefreshCcw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/contracts")({
  head: () => ({ meta: [{ title: "Contract Lifecycle — Bungoma CPMS" }] }),
  component: ContractsPage,
});

function ContractsPage() {
  const { user } = Route.useRouteContext();
  const { data: roles } = useRoles(user.id);
  const allowed = hasAnyRole(roles, ["system_admin","super_admin","director","supervisor"]);
  const qc = useQueryClient();
  const actFn = useServerFn(contractAction);
  const runFn = useServerFn(runMaintenance);

  const [filter, setFilter] = useState<"all"|"expiring"|"archived">("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [action, setAction] = useState<"restore"|"renew"|"extend"|"terminate">("renew");
  const [newEnd, setNewEnd] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: rows = [] } = useQuery({
    queryKey: ["contract-rows", filter],
    enabled: allowed,
    queryFn: async () => {
      let q = supabase.from("profiles")
        .select("id, full_name, id_number, department, employment_type, contract_start_date, contract_end_date, employee_status, status_change_reason, status_changed_at")
        .in("employment_type", ["contract","casual"])
        .order("contract_end_date", { ascending: true })
        .limit(200);
      if (filter === "archived") q = q.eq("employee_status", "archived");
      if (filter === "expiring") {
        const in30 = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
        q = q.lte("contract_end_date", in30).eq("employee_status", "active");
      }
      const { data } = await q;
      return data ?? [];
    },
  });

  async function runDaily() {
    setBusy(true);
    try {
      const r = await runFn({});
      toast.success(`Archived ${r.archived}`);
      qc.invalidateQueries({ queryKey: ["contract-rows"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  async function apply() {
    if (!selected) return;
    if ((action === "renew" || action === "extend") && !newEnd) { toast.error("Pick a new end date"); return; }
    if (reason.trim().length < 3) { toast.error("Reason required"); return; }
    setBusy(true);
    try {
      await actFn({ data: { employee_id: selected, action, new_end_date: newEnd || null, reason: reason.trim() } });
      toast.success(`${action} completed`);
      setSelected(null); setReason(""); setNewEnd("");
      qc.invalidateQueries({ queryKey: ["contract-rows"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  if (!allowed) return null;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader authenticated userId={user.id} />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-primary">Lifecycle</div>
            <h1 className="mt-2 font-display text-3xl font-bold">Contract Employee Management</h1>
            <p className="mt-1 text-sm text-muted-foreground">Monitor contract employees. Expired contracts auto-archive on daily maintenance.</p>
          </div>
          <Button onClick={runDaily} disabled={busy} variant="outline"><RefreshCcw className="mr-2 h-4 w-4"/>Run maintenance</Button>
        </div>

        <div className="mt-4 flex gap-2">
          {(["all","expiring","archived"] as const).map((f) => (
            <Button key={f} size="sm" variant={filter===f?"default":"outline"} onClick={() => setFilter(f)}>{f}</Button>
          ))}
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[2fr_1fr]">
          <Card className="p-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                <tr><th className="p-2 text-left">Employee</th><th className="p-2 text-left">Type</th><th className="p-2 text-left">End</th><th className="p-2 text-left">Status</th><th className="p-2"></th></tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const expired = e.contract_end_date && new Date(e.contract_end_date) < new Date();
                  return (
                    <tr key={e.id} className={`border-t border-border ${selected===e.id?"bg-primary/5":""}`}>
                      <td className="p-2"><div className="font-medium">{e.full_name}</div><div className="text-[11px] text-muted-foreground">{e.id_number} · {e.department}</div></td>
                      <td className="p-2 text-xs">{e.employment_type}</td>
                      <td className="p-2 text-xs"><span className={expired?"text-red-600 font-semibold":""}>{e.contract_end_date ?? "—"}</span></td>
                      <td className="p-2 text-xs">{e.employee_status}</td>
                      <td className="p-2 text-right"><Button size="sm" variant="ghost" onClick={() => setSelected(e.id)}>Act</Button></td>
                    </tr>
                  );
                })}
                {rows.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-sm text-muted-foreground"><FileWarning className="mx-auto h-6 w-6 mb-2"/>No matching contracts.</td></tr>}
              </tbody>
            </table>
          </Card>

          <Card className="p-5">
            <h3 className="font-display text-lg font-bold">Action</h3>
            {!selected ? <p className="mt-3 text-sm text-muted-foreground">Pick an employee.</p> : (
              <div className="mt-3 space-y-3">
                <div>
                  <Label>Action</Label>
                  <Select value={action} onValueChange={(v) => setAction(v as typeof action)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="restore">Restore</SelectItem>
                      <SelectItem value="renew">Renew contract</SelectItem>
                      <SelectItem value="extend">Extend contract</SelectItem>
                      <SelectItem value="terminate">Terminate permanently</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {(action === "renew" || action === "extend") && (
                  <div><Label>New end date</Label><Input type="date" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} /></div>
                )}
                <div><Label>Reason</Label><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
                <Button onClick={apply} disabled={busy} className="w-full">{busy?"Saving…":"Confirm"}</Button>
              </div>
            )}
          </Card>
        </div>
      </main>
    </div>
  );
}
