import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Plus, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/additional-assignments")({
  head: () => ({ meta: [{ title: "Additional Assignments — Bungoma CPMS" }] }),
  component: Page,
});

function Page() {
  const { user } = Route.useRouteContext();
  const { data: roles } = useRoles(user.id);
  const qc = useQueryClient();
  const isSupervisor = hasAnyRole(roles, ["supervisor", "director", "chief_officer", "system_admin", "super_admin"]);

  const { data: mine } = useQuery({
    queryKey: ["addl-mine", user.id],
    queryFn: async () => {
      const { data } = await supabase.from("additional_assignments").select("*").eq("employee_id", user.id).order("date_assigned", { ascending: false });
      return data ?? [];
    },
  });

  const { data: assigned } = useQuery({
    queryKey: ["addl-assigned", user.id],
    enabled: isSupervisor,
    queryFn: async () => {
      const { data } = await supabase.from("additional_assignments").select("*").eq("supervisor_id", user.id).order("date_assigned", { ascending: false });
      const rows = data ?? [];
      const empIds = Array.from(new Set(rows.map((r) => r.employee_id as string)));
      const { data: profs } = empIds.length ? await supabase.from("profiles").select("id, full_name, employee_no").in("id", empIds) : { data: [] };
      const map = new Map((profs ?? []).map((p) => [p.id, p]));
      return rows.map((r) => ({ ...r, profiles: map.get(r.employee_id as string) ?? null }));
    },
  });

  async function markComplete(id: string, summary: string) {
    if (!summary || summary.length < 5) return toast.error("Enter an achievement summary");
    const { error } = await supabase.from("additional_assignments").update({ status: "completed", completed_at: new Date().toISOString(), achievement_summary: summary }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Marked complete");
    qc.invalidateQueries({ queryKey: ["addl-mine", user.id] });
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader authenticated userId={user.id} />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="text-xs font-semibold uppercase tracking-widest text-primary">Additional Assignments</div>
        <h1 className="mt-1 font-display text-3xl font-bold">Ad-hoc responsibilities</h1>
        <p className="mt-1 text-sm text-muted-foreground">Assignments made outside the original workplan. Completed items appear on the CGB/SPA Form 2 quarterly report.</p>

        {isSupervisor && <AssignForm userId={user.id} qc={qc} />}

        <h2 className="mt-8 font-display text-xl font-bold">My assignments</h2>
        <div className="mt-2 space-y-2">
          {(mine ?? []).map((a) => (
            <MyRow key={a.id} row={a as Record<string, unknown>} onComplete={markComplete} />
          ))}
          {(!mine || mine.length === 0) && <Card className="p-6 text-sm text-muted-foreground">No additional assignments.</Card>}
        </div>

        {isSupervisor && (
          <>
            <h2 className="mt-8 font-display text-xl font-bold">Assigned by me</h2>
            <div className="mt-2 space-y-2">
              {(assigned ?? []).map((a) => {
                const r = a as Record<string, unknown> & { profiles?: { full_name?: string; employee_no?: string } };
                return (
                  <Card key={r.id as string} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="text-xs uppercase text-muted-foreground">{r.profiles?.full_name} · {r.profiles?.employee_no}</div>
                        <div className="font-semibold">{r.title as string}</div>
                        <div className="text-xs text-muted-foreground">Due {r.due_date ? new Date(r.due_date as string).toLocaleDateString() : "—"}</div>
                      </div>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase ${r.status === "completed" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700" : "border-amber-500/40 bg-amber-500/10 text-amber-700"}`}>{r.status as string}</span>
                    </div>
                  </Card>
                );
              })}
              {(!assigned || assigned.length === 0) && <Card className="p-6 text-sm text-muted-foreground">You haven't assigned any yet.</Card>}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function MyRow({ row, onComplete }: { row: Record<string, unknown>; onComplete: (id: string, summary: string) => void }) {
  const [summary, setSummary] = useState("");
  const done = row.status === "completed";
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-semibold">{row.title as string}</div>
          <div className="text-xs text-muted-foreground">{row.description as string}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">Assigned {new Date(row.date_assigned as string).toLocaleDateString()} · Due {row.due_date ? new Date(row.due_date as string).toLocaleDateString() : "—"}</div>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase ${done ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700" : "border-amber-500/40 bg-amber-500/10 text-amber-700"}`}>{row.status as string}</span>
      </div>
      {!done && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[240px]">
            <Label className="mb-1 block text-xs">Achievement summary</Label>
            <Input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What was delivered?" />
          </div>
          <Button size="sm" onClick={() => onComplete(row.id as string, summary)}><CheckCircle2 className="mr-1.5 h-4 w-4" />Mark complete</Button>
        </div>
      )}
      {done && Boolean(row.achievement_summary) && <div className="mt-2 text-sm"><span className="text-xs text-muted-foreground">Achievement:</span> {String(row.achievement_summary)}</div>}
    </Card>
  );
}

function AssignForm({ userId, qc }: { userId: string; qc: ReturnType<typeof useQueryClient> }) {
  const [employeeId, setEmployeeId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: employees } = useQuery({
    queryKey: ["addl-employees"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, employee_no").order("full_name").limit(500);
      return data ?? [];
    },
  });
  const opts = useMemo(() => employees ?? [], [employees]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId || !title) return toast.error("Employee and title required");
    setBusy(true);
    try {
      const { error } = await supabase.from("additional_assignments").insert({
        employee_id: employeeId, supervisor_id: userId,
        title, description: description || null, due_date: dueDate || null,
      });
      if (error) throw error;
      toast.success("Assigned");
      setTitle(""); setDescription(""); setDueDate("");
      qc.invalidateQueries({ queryKey: ["addl-assigned", userId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }

  return (
    <Card className="mt-6 p-5">
      <div className="mb-3 font-display text-lg font-bold">Assign additional responsibility</div>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label className="mb-1 block text-xs">Employee</Label>
          <Select value={employeeId} onValueChange={setEmployeeId}>
            <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
            <SelectContent>{opts.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name} · {p.employee_no}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="mb-1 block text-xs">Assignment title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="sm:col-span-2">
          <Label className="mb-1 block text-xs">Description</Label>
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <Label className="mb-1 block text-xs">Due date</Label>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        <div className="flex items-end justify-end">
          <Button type="submit" disabled={busy}><Plus className="mr-1.5 h-4 w-4" />{busy ? "Assigning…" : "Assign"}</Button>
        </div>
      </form>
    </Card>
  );
}
