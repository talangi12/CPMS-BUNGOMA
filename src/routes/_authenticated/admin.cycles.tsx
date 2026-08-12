import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useRoles, hasAnyRole } from "@/hooks/useRoles";
import { CalendarDays, Crown, ShieldCheck, CheckCircle2, Circle } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { sendEventEmail } from "@/lib/notify.functions";

export const Route = createFileRoute("/_authenticated/admin/cycles")({
  head: () => ({ meta: [{ title: "Appraisal Cycles — Bungoma CPMS" }] }),
  component: AdminCycles,
});

function AdminCycles() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const { data: roles } = useRoles(user.id);
  const isAdmin = hasAnyRole(roles, ["system_admin", "super_admin"]);
  const isGovernor = hasAnyRole(roles, ["governor"]);
  const notifyCycleOpenedFn = useServerFn(sendEventEmail);

  const { data: cycles } = useQuery({
    queryKey: ["cycles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appraisal_cycles")
        .select("*")
        .order("fy_start", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: departments } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const { data } = await supabase.from("departments").select("name").order("name");
      return data ?? [];
    },
  });

  const [label, setLabel] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  async function createCycle(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("appraisal_cycles").insert({
      fy_label: label, fy_start: start, fy_end: end, created_by: user.id,
    });
    if (error) return toast.error(error.message);
    toast.success("Cycle created");
    await supabase.rpc("log_audit", { _action: "cycle_created", _entity_type: "appraisal_cycles", _entity_id: label });
    setLabel(""); setStart(""); setEnd("");
    qc.invalidateQueries({ queryKey: ["cycles"] });
  }

  async function governorSign(cycleId: string, fyLabel: string) {
    const { error } = await supabase.from("appraisal_cycles").update({
      governor_signed_by: user.id, governor_signed_at: new Date().toISOString(), status: "governor_signed",
    }).eq("id", cycleId);
    if (error) return toast.error(error.message);
    toast.success("Governor approval recorded — propagating county-wide");
    await supabase.rpc("log_audit", { _action: "governor_signed_cycle", _entity_type: "appraisal_cycles", _entity_id: cycleId, _new: { fy_label: fyLabel } });
    qc.invalidateQueries({ queryKey: ["cycles"] });
    try {
      await notifyCycleOpenedFn({ data: {
        event_type: "cycle_opening",
        to_user_id: user.id,
        vars: { period: fyLabel },
        related_appraisal_id: null,
      }});
    } catch {
      // Notification failures are logged server-side.
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader authenticated userId={user.id} />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-primary">Administration</div>
          <h1 className="mt-2 font-display text-3xl font-bold flex items-center gap-2"><CalendarDays className="h-7 w-7 text-primary" />Appraisal Cycles</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Open a fiscal year cycle, capture the Governor's authorisation, and activate departments via Chief Officer → Director → Supervisor sign-off.
          </p>
        </div>

        {isAdmin && (
          <Card className="mt-6 p-6">
            <h2 className="font-display text-base font-bold">Open a new cycle</h2>
            <form onSubmit={createCycle} className="mt-3 grid gap-3 sm:grid-cols-4">
              <div className="sm:col-span-2"><Label>Label</Label><Input required value={label} onChange={(e) => setLabel(e.target.value)} placeholder="FY 2026/2027" /></div>
              <div><Label>Start</Label><Input type="date" required value={start} onChange={(e) => setStart(e.target.value)} /></div>
              <div><Label>End</Label><Input type="date" required value={end} onChange={(e) => setEnd(e.target.value)} /></div>
              <div className="sm:col-span-4 flex justify-end"><Button type="submit">Create cycle</Button></div>
            </form>
          </Card>
        )}

        <div className="mt-6 space-y-5">
          {(cycles ?? []).map((c) => (
            <Card key={c.id} className="p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-xl font-bold">{c.fy_label}</h3>
                  <p className="text-xs text-muted-foreground">{c.fy_start} → {c.fy_end}</p>
                </div>
                {c.governor_signed_at ? (
                  <Badge className="gap-1 bg-primary text-primary-foreground"><Crown className="h-3 w-3" /> Governor signed · county-wide unlocked</Badge>
                ) : (
                  <Badge variant="outline" className="gap-1"><Crown className="h-3 w-3" /> Awaiting Governor</Badge>
                )}
              </div>

              {isAdmin && !c.governor_signed_at && (
                <EditCycleDates cycle={c} onSaved={() => qc.invalidateQueries({ queryKey: ["cycles"] })} />
              )}

              <StageSchedule fyStart={c.fy_start} fyEnd={c.fy_end} />

              {!c.governor_signed_at && isGovernor && (
                <div className="mt-4 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-4">
                  <p className="text-sm">As Governor, your single signature authorises this cycle across all 7,000+ employees.</p>
                  <Button onClick={() => governorSign(c.id, c.fy_label)} className="mt-3"><Crown className="mr-2 h-4 w-4" /> Sign as Governor</Button>
                </div>
              )}
              {!c.governor_signed_at && !isGovernor && (
                <p className="mt-3 text-xs text-muted-foreground">Only a user with the Governor role may sign this cycle.</p>
              )}

              <DeptActivations cycleId={c.id} departments={(departments ?? []).map((d) => d.name)} userId={user.id} canAdminOverride={isAdmin} />
            </Card>
          ))}
          {(cycles?.length ?? 0) === 0 && (
            <Card className="p-10 text-center text-muted-foreground"><p>No cycles yet.</p></Card>
          )}
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          Every employee's stage calendar (Contract → Target Setting → Q1 → Mid-Year → Q3 → End-Year → Closed) is derived automatically from the most recent cycle's start date. Adjusting the dates above updates every user's calendar immediately.
        </p>

      </main>
    </div>
  );
}

function DeptActivations({ cycleId, departments, userId, canAdminOverride }: { cycleId: string; departments: string[]; userId: string; canAdminOverride: boolean }) {
  const qc = useQueryClient();
  const { data: activations } = useQuery({
    queryKey: ["activations", cycleId],
    queryFn: async () => {
      const { data } = await supabase.from("cycle_department_activations").select("*").eq("cycle_id", cycleId);
      return data ?? [];
    },
  });

  const { data: myRoleRows } = useQuery({
    queryKey: ["my-role-rows", userId],
    queryFn: async () => {
      const { data } = await supabase.from("user_roles").select("role, department").eq("user_id", userId);
      return data ?? [];
    },
  });

  function myRoleInDept(dept: string, role: string) {
    return (myRoleRows ?? []).some((r) => r.role === role && (r.department === null || r.department === dept));
  }

  async function sign(dept: string, kind: "chief_officer" | "director" | "supervisor") {
    if (!canAdminOverride && !myRoleInDept(dept, kind)) {
      return toast.error("Unauthorized Signatory. You do not possess the required role for this signature.");
    }
    const existing = (activations ?? []).find((a) => a.department === dept);
    const now = new Date().toISOString();
    const payload =
      kind === "chief_officer" ? { chief_officer_id: userId, chief_officer_signed_at: now } :
      kind === "director"      ? { director_id: userId, director_signed_at: now } :
                                 { supervisor_id: userId, supervisor_signed_at: now };

    if (existing) {
      const { error } = await supabase.from("cycle_department_activations").update(payload).eq("id", existing.id);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("cycle_department_activations").insert({ cycle_id: cycleId, department: dept, ...payload });
      if (error) return toast.error(error.message);
    }
    toast.success(`${kind.replace("_", " ")} signature recorded for ${dept}`);
    await supabase.rpc("log_audit", { _action: `${kind}_signed_dept`, _entity_type: "cycle_department_activations", _entity_id: `${cycleId}:${dept}` });
    qc.invalidateQueries({ queryKey: ["activations", cycleId] });
  }

  return (
    <div className="mt-5 overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-left uppercase tracking-wider text-muted-foreground">
          <tr><th className="py-2">Department</th><th>Chief Officer</th><th>Director</th><th>Supervisor</th><th>Status</th></tr>
        </thead>
        <tbody>
          {departments.map((d) => {
            const a = (activations ?? []).find((x) => x.department === d);
            const allSigned = !!(a?.chief_officer_signed_at && a?.director_signed_at && a?.supervisor_signed_at);
            return (
              <tr key={d} className="border-t border-border">
                <td className="py-2 font-medium">{d}</td>
                {(["chief_officer", "director", "supervisor"] as const).map((k) => {
                  const signedAt = a ? (k === "chief_officer" ? a.chief_officer_signed_at : k === "director" ? a.director_signed_at : a.supervisor_signed_at) : null;
                  return (
                    <td key={k} className="py-2">
                      {signedAt ? (
                        <span className="inline-flex items-center gap-1 text-primary"><CheckCircle2 className="h-3 w-3" /> Signed</span>
                      ) : (
                        <button onClick={() => sign(d, k)} className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary">
                          <Circle className="h-3 w-3" /> Sign
                        </button>
                      )}
                    </td>
                  );
                })}
                <td className="py-2">
                  {allSigned ? (
                    <Badge className="gap-1 bg-primary text-primary-foreground"><ShieldCheck className="h-3 w-3" /> Active</Badge>
                  ) : (
                    <Badge variant="outline">Blocked</Badge>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type Cycle = { id: string; fy_label: string; fy_start: string; fy_end: string };

function EditCycleDates({ cycle, onSaved }: { cycle: Cycle; onSaved: () => void }) {
  const [start, setStart] = useState(cycle.fy_start);
  const [end, setEnd] = useState(cycle.fy_end);
  const [label, setLabel] = useState(cycle.fy_label);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const { error } = await supabase.from("appraisal_cycles")
      .update({ fy_label: label, fy_start: start, fy_end: end })
      .eq("id", cycle.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    await supabase.rpc("log_audit", { _action: "cycle_dates_updated", _entity_type: "appraisal_cycles", _entity_id: cycle.id, _new: { fy_label: label, fy_start: start, fy_end: end } });
    toast.success("Cycle dates updated — calendar refreshes on next page load");
    onSaved();
  }

  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/30 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Edit dates (before Governor signature)</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2"><Label>Label</Label><Input value={label} onChange={(e) => setLabel(e.target.value)} /></div>
        <div><Label>Start</Label><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
        <div><Label>End</Label><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        <div className="sm:col-span-4 flex justify-end"><Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Update dates"}</Button></div>
      </div>
    </div>
  );
}

function StageSchedule({ fyStart, fyEnd }: { fyStart: string | null; fyEnd: string | null }) {
  if (!fyStart) return null;
  const start = new Date(fyStart);
  const addMonths = (m: number) => {
    const d = new Date(start); d.setMonth(d.getMonth() + m); return d.toISOString().slice(0, 10);
  };
  const addDays = (n: number) => {
    const d = new Date(start); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10);
  };
  const stages = [
    { label: "Performance Contract sign-off", date: addDays(-30) },
    { label: "Target Setting opens", date: fyStart },
    { label: "Supervisor Review & Approval", date: addDays(14) },
    { label: "Q1 Review", date: addMonths(3) },
    { label: "Mid-Year Review (Q2)", date: addMonths(6) },
    { label: "Q3 Review", date: addMonths(9) },
    { label: "End-Year Appraisal (Q4)", date: addMonths(12) },
    { label: "Cycle Closed / Appeals", date: fyEnd ?? addMonths(13) },
  ];
  return (
    <div className="mt-4 rounded-lg border border-border p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Derived stage calendar (what employees will see)</p>
      <ol className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
        {stages.map((s) => (
          <li key={s.label} className="flex justify-between gap-4 rounded px-2 py-1 hover:bg-muted/40">
            <span>{s.label}</span>
            <span className="font-mono text-xs text-muted-foreground">{s.date}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
