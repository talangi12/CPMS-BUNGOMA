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
import { CalendarCheck, Save, Lock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/endyear")({
  head: () => ({ meta: [{ title: "End-Year Review — Bungoma CPMS" }] }),
  component: EndYearPage,
});

type Row = {
  id: string;
  target: string;
  weight: number;
  endyear_actual: string;
  endyear_self_score: number | null;
  endyear_supervisor_score: number | null;
  endyear_self_comment: string;
  endyear_supervisor_comment: string;
};

type SelfReflections = {
  resources_needed: string;
  recommendations: string;
  training_needs: string;
  additional_comments: string;
};

function EndYearPage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const [appraisalId, setAppraisalId] = useState("");
  const [selfOverall, setSelfOverall] = useState("");
  const [refl, setRefl] = useState<SelfReflections>({
    resources_needed: "", recommendations: "", training_needs: "", additional_comments: "",
  });

  const { data: list } = useQuery({
    queryKey: ["endyear-list", user.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("appraisals")
        .select("id, period, employee_id, chosen_supervisor_id, endyear_unlocked_at, profiles:employee_id(full_name)")
        .or(`employee_id.eq.${user.id},chosen_supervisor_id.eq.${user.id}`)
        .not("endyear_unlocked_at", "is", null)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  useEffect(() => { if (list?.length && !appraisalId) setAppraisalId(list[0].id); }, [list, appraisalId]);

  const { data: active } = useQuery({
    queryKey: ["endyear", appraisalId],
    enabled: !!appraisalId,
    queryFn: async () => {
      const { data } = await supabase.from("appraisals").select("*, targets(*)").eq("id", appraisalId).maybeSingle();
      return data;
    },
  });

  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    if (!active) return;
    setSelfOverall(active.self_overall_comment ?? "");
    setRefl({
      resources_needed: active.self_resources_needed ?? "",
      recommendations: active.self_recommendations ?? "",
      training_needs: active.self_training_needs ?? "",
      additional_comments: active.self_additional_comments ?? "",
    });
    const sorted = [...(active.targets ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    setRows(sorted.map((t) => ({
      id: t.id,
      target: t.target,
      weight: Number(t.weight) || 0,
      endyear_actual: t.endyear_actual ?? "",
      endyear_self_score: t.endyear_self_score == null ? null : Number(t.endyear_self_score),
      endyear_supervisor_score: t.endyear_supervisor_score == null ? null : Number(t.endyear_supervisor_score),
      endyear_self_comment: t.endyear_self_comment ?? "",
      endyear_supervisor_comment: t.endyear_supervisor_comment ?? "",
    })));
  }, [active]);

  const isMine = active?.employee_id === user.id;
  const isMySup = active?.chosen_supervisor_id === user.id;

  async function save() {
    try {
      for (const r of rows) {
        const patch: {
          endyear_actual?: string;
          endyear_self_score?: number | null;
          endyear_self_comment?: string;
          endyear_supervisor_score?: number | null;
          endyear_supervisor_comment?: string;
        } = {};
        if (isMine) {
          patch.endyear_actual = r.endyear_actual;
          patch.endyear_self_score = r.endyear_self_score;
          patch.endyear_self_comment = r.endyear_self_comment;
        }
        if (isMySup) {
          patch.endyear_supervisor_score = r.endyear_supervisor_score;
          patch.endyear_supervisor_comment = r.endyear_supervisor_comment;
        }
        if (Object.keys(patch).length === 0) continue;
        const { error } = await supabase.from("targets").update(patch).eq("id", r.id);
        if (error) throw error;
      }
      if (isMine && active) {
        await supabase.from("appraisals").update({
          self_overall_comment: selfOverall || null,
          self_resources_needed: refl.resources_needed || null,
          self_recommendations: refl.recommendations || null,
          self_training_needs: refl.training_needs || null,
          self_additional_comments: refl.additional_comments || null,
          endyear_completed_at: new Date().toISOString(),
        }).eq("id", active.id);
      }
      toast.success("End-year review saved");
      qc.invalidateQueries({ queryKey: ["endyear", appraisalId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader authenticated userId={user.id} />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-primary">Section 4 · End of cycle</div>
          <h1 className="mt-2 font-display text-3xl font-bold">End-Year Review</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Unlocks automatically 12 months after the fiscal year start. Record final results, self-rate, and capture supervisor scores.
          </p>
        </div>

        {(!list || list.length === 0) && (
          <Card className="mt-8 p-10 text-center">
            <Lock className="mx-auto h-10 w-10 text-muted-foreground" />
            <h2 className="mt-3 font-display text-xl font-bold">End-Year is locked</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Opens 12 months after your fiscal year starts, once your appraisal has been approved.
            </p>
            <Link to="/midyear" className="mt-4 inline-block"><Button variant="outline">Go to Mid-Year</Button></Link>
          </Card>
        )}

        {list && list.length > 0 && (
          <>
            <Card className="mt-6 p-4">
              <Label className="text-xs">Choose cycle</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {list.map((a) => (
                  <button key={a.id} onClick={() => setAppraisalId(a.id)}
                    className={`rounded-md border px-3 py-1.5 text-xs ${a.id === appraisalId ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>
                    {a.period} · {a.employee_id === user.id ? "You" : (a.profiles as { full_name?: string } | null)?.full_name ?? "Employee"}
                  </button>
                ))}
              </div>
            </Card>

            <Card className="mt-6 p-6">
              <div className="flex items-center gap-2">
                <CalendarCheck className="h-4 w-4 text-primary" />
                <h2 className="font-display text-lg font-bold">Final results & scoring</h2>
              </div>
              <div className="mt-4 space-y-4">
                {rows.map((r, i) => (
                  <div key={r.id} className="rounded-lg border border-border bg-muted/30 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wider text-primary">Target {i + 1} · weight {r.weight}%</div>
                    <div className="mt-1 text-sm font-medium">{r.target}</div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <Label className="mb-1 block text-xs">Final achieved result (appraisee)</Label>
                        <Textarea rows={2} disabled={!isMine}
                          value={r.endyear_actual}
                          onChange={(e) => setRows((p) => p.map((x, idx) => idx === i ? { ...x, endyear_actual: e.target.value } : x))}
                          placeholder="What was delivered against the target." />
                      </div>
                      <div>
                        <Label className="mb-1 block text-xs">Self-score (0–150)</Label>
                        <Input type="number" min={0} max={150} disabled={!isMine}
                          value={r.endyear_self_score ?? ""}
                          onChange={(e) => setRows((p) => p.map((x, idx) => idx === i ? { ...x, endyear_self_score: e.target.value === "" ? null : Number(e.target.value) } : x))} />
                      </div>
                      <div>
                        <Label className="mb-1 block text-xs">Supervisor score (0–150)</Label>
                        <Input type="number" min={0} max={150} disabled={!isMySup}
                          value={r.endyear_supervisor_score ?? ""}
                          onChange={(e) => setRows((p) => p.map((x, idx) => idx === i ? { ...x, endyear_supervisor_score: e.target.value === "" ? null : Number(e.target.value) } : x))} />
                      </div>
                      <div>
                        <Label className="mb-1 block text-xs">Self comment</Label>
                        <Textarea rows={2} disabled={!isMine}
                          value={r.endyear_self_comment}
                          onChange={(e) => setRows((p) => p.map((x, idx) => idx === i ? { ...x, endyear_self_comment: e.target.value } : x))} />
                      </div>
                      <div>
                        <Label className="mb-1 block text-xs">Supervisor comment</Label>
                        <Textarea rows={2} disabled={!isMySup}
                          value={r.endyear_supervisor_comment}
                          onChange={(e) => setRows((p) => p.map((x, idx) => idx === i ? { ...x, endyear_supervisor_comment: e.target.value } : x))} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-8 space-y-4">
                <div className="text-xs font-semibold uppercase tracking-widest text-primary">Section 5 · Self-appraisal reflections</div>
                {[
                  { key: "resources_needed" as const, label: "Resources and Support Required." },
                  { key: "recommendations" as const, label: "Recommendations." },
                  { key: "training_needs" as const, label: "Training & Capacity Building Needs." },
                  { key: "additional_comments" as const, label: "Additional Comments." },
                ].map((q) => (
                  <div key={q.key}>
                    <Label className="mb-1.5 block text-xs">{q.label}</Label>
                    <Textarea rows={3} disabled={!isMine} value={refl[q.key]}
                      onChange={(e) => setRefl((p) => ({ ...p, [q.key]: e.target.value }))} />
                  </div>
                ))}
                <div>
                  <Label className="mb-1.5 block text-xs">Overall self-assessment statement</Label>
                  <Textarea rows={3} disabled={!isMine}
                    value={selfOverall} onChange={(e) => setSelfOverall(e.target.value)}
                    placeholder="Reflect on your overall performance, achievements and learnings this cycle." />
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <Button onClick={save}><Save className="mr-1.5 h-4 w-4" /> Save end-year review</Button>
              </div>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
