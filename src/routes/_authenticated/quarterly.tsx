import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CalendarRange, Save } from "lucide-react";
import { toast } from "sonner";
import { saveQuarterProgress } from "@/lib/quarterly.functions";

export const Route = createFileRoute("/_authenticated/quarterly")({
  head: () => ({ meta: [{ title: "Quarterly Progress — Bungoma CPMS" }] }),
  component: QuarterlyPage,
});

const period = `FY ${new Date().getFullYear()}/${(new Date().getFullYear() + 1).toString().slice(-2)}`;

function QuarterlyPage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const saveFn = useServerFn(saveQuarterProgress);
  const [quarter, setQuarter] = useState<number>(1);

  const { data, isLoading } = useQuery({
    queryKey: ["quarterly", user.id, period],
    queryFn: async () => {
      const { data: app } = await supabase
        .from("appraisals")
        .select("id, status, fy_start, targets(*)")
        .eq("employee_id", user.id)
        .eq("period", period)
        .maybeSingle();
      if (!app) return { appraisal: null, progress: [] as any[] };
      const { data: prog } = await supabase
        .from("target_quarter_progress")
        .select("*")
        .eq("appraisal_id", app.id);
      return { appraisal: app, progress: prog ?? [] };
    },
  });

  const currentQuarter = useMemo(() => {
    const fy = data?.appraisal?.fy_start ? new Date(data.appraisal.fy_start) : null;
    if (!fy) return null;
    const months = (new Date().getTime() - fy.getTime()) / (1000 * 60 * 60 * 24 * 30);
    if (months < 0) return null;
    if (months < 3) return 1;
    if (months < 6) return 2;
    if (months < 9) return 3;
    return 4;
  }, [data]);

  const progressFor = (targetId: string, q: number) =>
    data?.progress.find((p) => p.target_id === targetId && p.quarter === q);

  async function handleSave(targetId: string, fields: { progress_note: string; achieved_value: string; self_score: string }) {
    if (!data?.appraisal) return;
    try {
      await saveFn({ data: {
        appraisal_id: data.appraisal.id,
        target_id: targetId,
        quarter,
        progress_note: fields.progress_note || null,
        achieved_value: fields.achieved_value || null,
        self_score: fields.self_score ? Number(fields.self_score) : null,
      } });
      toast.success(`Q${quarter} progress saved.`);
      qc.invalidateQueries({ queryKey: ["quarterly", user.id, period] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader authenticated userId={user.id} />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="font-display text-3xl font-bold">Quarterly Progress</h1>
            <p className="text-sm text-muted-foreground">Record quarterly achievements against your approved targets.</p>
          </div>
          <Badge variant="outline" className="text-xs">
            <CalendarRange className="mr-1 h-3 w-3" /> {period}
            {currentQuarter && <span className="ml-2">· Current: Q{currentQuarter}</span>}
          </Badge>
        </div>

        {isLoading ? (
          <Card className="p-10 text-center text-muted-foreground">Loading…</Card>
        ) : !data?.appraisal ? (
          <Card className="p-10 text-center text-muted-foreground">
            No appraisal found for {period}. Create your targets first under My Appraisal.
          </Card>
        ) : data.appraisal.status !== "approved" && data.appraisal.status !== "midyear" ? (
          <Card className="p-10 text-center text-muted-foreground">
            Quarterly tracking unlocks once your supervisor approves your targets. Current status: <b>{data.appraisal.status}</b>.
          </Card>
        ) : (
          <>
            <div className="mb-4 flex gap-2">
              {[1, 2, 3, 4].map((q) => (
                <Button key={q} variant={quarter === q ? "default" : "outline"} size="sm" onClick={() => setQuarter(q)}>
                  Q{q}
                </Button>
              ))}
            </div>

            <div className="space-y-4">
              {(data.appraisal.targets ?? []).map((t: any) => {
                const existing = progressFor(t.id, quarter);
                return (
                  <QuarterTargetCard
                    key={t.id}
                    target={t}
                    quarter={quarter}
                    existing={existing}
                    onSave={(f) => handleSave(t.id, f)}
                  />
                );
              })}
              {(data.appraisal.targets ?? []).length === 0 && (
                <Card className="p-10 text-center text-muted-foreground">No targets defined yet.</Card>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function QuarterTargetCard({ target, quarter, existing, onSave }: {
  target: any; quarter: number; existing: any;
  onSave: (f: { progress_note: string; achieved_value: string; self_score: string }) => void | Promise<void>;
}) {
  const [note, setNote] = useState(existing?.progress_note ?? "");
  const [actual, setActual] = useState(existing?.achieved_value ?? "");
  const [score, setScore] = useState(existing?.self_score?.toString() ?? "");

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <div className="font-semibold">{target.target}</div>
          <div className="text-xs text-muted-foreground">Indicator: {target.indicator} · Weight {target.weight}%</div>
        </div>
        {existing?.reviewed_at && (
          <Badge className="bg-primary/10 text-primary">Reviewed</Badge>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Label className="text-xs">What was achieved this quarter</Label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </div>
        <div>
          <Label className="text-xs">Quantitative result</Label>
          <Input value={actual} onChange={(e) => setActual(e.target.value)} placeholder="e.g. 42 of 60" />
        </div>
        <div>
          <Label className="text-xs">Self-score (%)</Label>
          <Input type="number" min={0} max={120} value={score} onChange={(e) => setScore(e.target.value)} />
        </div>
        <div className="sm:col-span-2 flex items-end justify-end">
          <Button size="sm" onClick={() => onSave({ progress_note: note, achieved_value: actual, self_score: score })}>
            <Save className="mr-1.5 h-4 w-4" /> Save Q{quarter}
          </Button>
        </div>
      </div>
      {existing?.supervisor_comment && (
        <div className="mt-3 rounded-md bg-muted/50 p-3 text-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Supervisor remark</div>
          <div className="mt-1">{existing.supervisor_comment}</div>
          {existing.supervisor_score != null && <div className="mt-1 text-xs">Score: {existing.supervisor_score}%</div>}
        </div>
      )}
    </Card>
  );
}
