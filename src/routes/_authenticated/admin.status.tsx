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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useRoles, hasAnyRole } from "@/hooks/useRoles";
import { changeEmployeeStatus, runMaintenance } from "@/lib/status.functions";
import { UserCog, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/status")({
  head: () => ({ meta: [{ title: "Employee Status — Bungoma CPMS" }] }),
  component: StatusPage,
});

const STATUSES = ["active","archived","on_leave","suspended","transferred","retired","terminated"] as const;

function StatusPage() {
  const { user } = Route.useRouteContext();
  const { data: roles } = useRoles(user.id);
  const allowed = hasAnyRole(roles, ["system_admin","super_admin"]);
  const qc = useQueryClient();
  const changeFn = useServerFn(changeEmployeeStatus);
  const runFn = useServerFn(runMaintenance);

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [newStatus, setNewStatus] = useState<typeof STATUSES[number]>("active");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: employees = [] } = useQuery({
    queryKey: ["status-employees", search],
    enabled: allowed,
    queryFn: async () => {
      let q = supabase.from("profiles")
        .select("id, full_name, id_number, designation, department, employee_status, employment_type, contract_end_date, status_change_reason, status_changed_at")
        .order("full_name").limit(100);
      if (search.trim()) q = q.or(`full_name.ilike.%${search}%,id_number.ilike.%${search}%,department.ilike.%${search}%`);
      const { data } = await q;
      return data ?? [];
    },
  });

  const { data: history } = useQuery({
    queryKey: ["status-history", selected],
    enabled: !!selected,
    queryFn: async () => {
      const { data } = await supabase.from("employee_status_history")
        .select("*").eq("employee_id", selected!).order("changed_at", { ascending: false }).limit(20);
      return data ?? [];
    },
  });

  if (!allowed) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader authenticated userId={user.id} />
        <main className="mx-auto max-w-3xl px-4 py-16">
          <Card className="p-10 text-center"><ShieldAlert className="mx-auto h-10 w-10 text-muted-foreground" /><h1 className="mt-3 font-display text-2xl font-bold">System Administrator access required</h1></Card>
        </main>
      </div>
    );
  }

  async function apply() {
    if (!selected) return;
    if (reason.trim().length < 3) { toast.error("Reason required"); return; }
    setBusy(true);
    try {
      await changeFn({ data: { employee_id: selected, new_status: newStatus, reason: reason.trim() } });
      toast.success("Status updated");
      setReason(""); setSelected(null);
      qc.invalidateQueries({ queryKey: ["status-employees"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  async function runDaily() {
    setBusy(true);
    try {
      const r = await runFn({});
      toast.success(`Maintenance complete — archived ${r.archived}`);
      qc.invalidateQueries({ queryKey: ["status-employees"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader authenticated userId={user.id} />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-primary">Administration</div>
            <h1 className="mt-2 font-display text-3xl font-bold">Employee Status Management</h1>
            <p className="mt-1 text-sm text-muted-foreground">Change employee lifecycle status. Every change is logged with actor, reason, and timestamps.</p>
          </div>
          <Button onClick={runDaily} disabled={busy} variant="outline"><UserCog className="mr-2 h-4 w-4"/>Run daily maintenance</Button>
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-[2fr_1fr]">
          <Card className="p-5">
            <Input placeholder="Search by name, ID number, department…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="mt-4 max-h-[60vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                  <tr><th className="p-2 text-left">Employee</th><th className="p-2 text-left">Type</th><th className="p-2 text-left">Status</th><th className="p-2"></th></tr>
                </thead>
                <tbody>
                  {employees.map((e) => (
                    <tr key={e.id} className={`border-t border-border ${selected===e.id?"bg-primary/5":""}`}>
                      <td className="p-2">
                        <div className="font-medium">{e.full_name}</div>
                        <div className="text-[11px] text-muted-foreground">{e.id_number} · {e.designation} · {e.department}</div>
                      </td>
                      <td className="p-2 text-xs">{e.employment_type}</td>
                      <td className="p-2"><StatusPill status={e.employee_status} /></td>
                      <td className="p-2 text-right"><Button size="sm" variant="ghost" onClick={() => { setSelected(e.id); setNewStatus((e.employee_status ?? "active") as typeof STATUSES[number]); }}>Manage</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="font-display text-lg font-bold">Apply status change</h3>
            {!selected ? <p className="mt-3 text-sm text-muted-foreground">Pick an employee from the list.</p> : (
              <div className="mt-3 space-y-3">
                <div>
                  <Label>New status</Label>
                  <Select value={newStatus} onValueChange={(v) => setNewStatus(v as typeof STATUSES[number])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Reason</Label>
                  <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
                <Button onClick={apply} disabled={busy} className="w-full">{busy?"Saving…":"Apply"}</Button>

                {history && history.length > 0 && (
                  <div className="mt-5">
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">History</div>
                    <ul className="mt-2 space-y-2 text-xs">
                      {history.map((h) => (
                        <li key={h.id} className="rounded-md border border-border p-2">
                          <div><b>{h.previous_status ?? "—"}</b> → <b>{h.new_status}</b></div>
                          <div className="text-muted-foreground">{h.reason}</div>
                          <div className="text-[10px] text-muted-foreground">{new Date(h.changed_at).toLocaleString()}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      </main>
    </div>
  );
}

function StatusPill({ status }: { status: string | null }) {
  const map: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-800",
    archived: "bg-amber-100 text-amber-800",
    on_leave: "bg-blue-100 text-blue-800",
    suspended: "bg-orange-100 text-orange-800",
    transferred: "bg-violet-100 text-violet-800",
    retired: "bg-slate-100 text-slate-800",
    terminated: "bg-red-100 text-red-800",
  };
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${map[status ?? "active"] ?? "bg-muted"}`}>{status ?? "—"}</span>;
}
