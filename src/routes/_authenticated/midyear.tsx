import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { CalendarClock, Save, Lock } from "lucide-react";
import { useRoles, hasAnyRole } from "@/hooks/useRoles";

export const Route = createFileRoute("/_authenticated/midyear")({
  head: () => ({ meta: [{ title: "Mid-Year Review — Bungoma CPMS" }] }),
  component: MidYearPage,
});

type TargetEdit = {
  id: string;
  target: string;
  weight: number;
  midyear_progress: string;
  midyear_score: number | null;
  midyear_supervisor_comment: string;
};

function MidYearPage() {
  const { user } = Route.useRouteContext();
  const { data: roles } = useRoles(user.id);
  const isSupervisor = hasAnyRole(roles, ["supervisor"]);
  const qc = useQueryClient();
  const [appraisalId, setAppraisalId] = useState<string>("");

  const { data: list } = useQuery({
    queryKey: ["midyear-list", user.id],
    queryFn: async () => {
      // appraisals where I'm the employee OR supervisor and midyear unlocked
      const { data } = await supabase
        .from("appraisals")
        .select("id, period, status, midyear_unlocked_at, employee_id, chosen_supervisor_id, profiles:employee_id(full_name)")
        .or(`employee_id.eq.${user.id},chosen_supervisor_id.eq.${user.id}`)
        .in("status", ["approved", "midyear", "completed"])
        .not("midyear_unlocked_at", "is", null)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  useEffect(() => {
    if (list && list.length && !appraisalId) setAppraisalId(list[0].id);
  }, [list, appraisalId]);

  const { data: active } = useQuery({
    queryKey: ["midyear", appraisalId],
    enabled: !!appraisalId,
    queryFn: async () => {
      const { data: a } = await supabase.from("appraisals").select("*, targets(*)").eq("id", appraisalId).maybeSingle();
      return a;
    },
  });

  const [rows, setRows] = useState<TargetEdit[]>([]);
  useEffect(() => {
    if (!active) return;
    const sorted = [...(active.targets ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    setRows(sorted.map((t) => ({
      id: t.id,
      target: t.target,
      weight: Number(t.weight) || 0,
      midyear_progress: t.midyear_progress ?? "",
      midyear_score: t.midyear_score == null ? null : Number(t.midyear_score),
      midyear_supervisor_comment: t.midyear_supervisor_comment ?? "",
    })));
  }, [active]);

  const isMyAppraisal = active?.employee_id === user.id;
  const isMySupervisor = active?.chosen_supervisor_id === user.id;

  async function save() {
    try {
      for (const r of rows) {
        const patch: {
          midyear_progress?: string;
          midyear_score?: number | null;
          midyear_supervisor_comment?: string;
        } = {};
        if (isMyAppraisal) {
          patch.midyear_progress = r.midyear_progress;
          patch.midyear_score = r.midyear_score;
        }
        if (isMySupervisor || isSupervisor) {
          patch.midyear_supervisor_comment = r.midyear_supervisor_comment;
        }
        if (Object.keys(patch).length === 0) continue;
        const { error } = await supabase.from("targets").update(patch).eq("id", r.id);
        if (error) throw error;
      }
      if (isMyAppraisal && active && active.status === "approved") {
        await supabase.from("appraisals").update({ status: "midyear" }).eq("id", active.id);
      }
      toast.success("Mid-year review saved");
      qc.invalidateQueries({ queryKey: ["midyear", appraisalId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader authenticated userId={user.id} />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-primary">Section 3</div>
          <h1 className="mt-2 font-display text-3xl font-bold">Mid-Year Review</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Unlocks automatically at the midpoint of the fiscal year. Appraisees record progress; supervisors leave guiding comments.
          </p>
        </div>

        {(!list || list.length === 0) && (
          <Card className="mt-8 p-10 text-center">
            <Lock className="mx-auto h-10 w-10 text-muted-foreground" />
            <h2 className="mt-3 font-display text-xl font-bold">Mid-Year is locked</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The Mid-Year Review opens once your appraisal has been approved AND six months of the fiscal year have elapsed.
            </p>
            <Link to="/appraisal" className="mt-4 inline-block"><Button variant="outline">Go to my appraisal</Button></Link>
          </Card>
        )}

        {list && list.length > 0 && (
          <>
            <Card className="mt-6 p-4">
              <Label className="text-xs">Choose cycle</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {list.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setAppraisalId(a.id)}
                    className={`rounded-md border px-3 py-1.5 text-xs ${a.id === appraisalId ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}
                  >
                    {a.period} · {a.employee_id === user.id ? "You" : (a.profiles as { full_name?: string } | null)?.full_name ?? "Employee"}
                  </button>
                ))}
              </div>
            </Card>

            <Card className="mt-6 p-6">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-primary" />
                <h2 className="font-display text-lg font-bold">Progress against targets</h2>
              </div>
              <div className="mt-4 space-y-4">
                {rows.map((r, i) => (
                  <div key={r.id} className="rounded-lg border border-border bg-muted/30 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wider text-primary">Target {i + 1} · weight {r.weight}%</div>
                    <div className="mt-1 text-sm font-medium">{r.target}</div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label className="mb-1 block text-xs">Progress notes (appraisee)</Label>
                        <Textarea
                          rows={3}
                          disabled={!isMyAppraisal}
                          value={r.midyear_progress}
                          onChange={(e) => setRows((p) => p.map((x, idx) => idx === i ? { ...x, midyear_progress: e.target.value } : x))}
                          placeholder="What's done so far, blockers, next steps…"
                        />
                      </div>
                      <div>
                        <Label className="mb-1 block text-xs">Mid-year score (0–100)</Label>
                        <Input
                          type="number" min={0} max={150}
                          disabled={!isMyAppraisal}
                          value={r.midyear_score ?? ""}
                          onChange={(e) => setRows((p) => p.map((x, idx) => idx === i ? { ...x, midyear_score: e.target.value === "" ? null : Number(e.target.value) } : x))}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <Label className="mb-1 block text-xs">Supervisor comment</Label>
                        <Textarea
                          rows={2}
                          disabled={!isMySupervisor}
                          value={r.midyear_supervisor_comment}
                          onChange={(e) => setRows((p) => p.map((x, idx) => idx === i ? { ...x, midyear_supervisor_comment: e.target.value } : x))}
                          placeholder={isMySupervisor ? "Coaching feedback…" : "Visible to supervisor only"}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 flex justify-end">
                <Button onClick={save}><Save className="mr-1.5 h-4 w-4" /> Save mid-year review</Button>
              </div>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
