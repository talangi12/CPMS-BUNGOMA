import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, XCircle, AlertCircle, Send } from "lucide-react";
import { RatingBadge, classify } from "@/components/RatingBadge";

export type SummaryTarget = {
  target: string;
  indicator: string;
  weight: number;
  expected_outcome: string;
  achieved_result: string;
  score: number;
};

export type SummarySelf = {
  resources_needed: string;
  recommendations: string;
  training_needs: string;
  additional: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
  submitting: boolean;
  profile: { full_name?: string | null; designation?: string | null; department?: string | null; employee_no?: string | null } | null | undefined;
  period: string;
  supervisorName: string | null;
  targets: SummaryTarget[];
  self: SummarySelf;
  signedAt: string | null;
  totals: { weight: number; pct: number | null };
};

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-xs">
      {ok ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> : <XCircle className="h-3.5 w-3.5 text-destructive" />}
      <span className={ok ? "" : "text-destructive"}>{label}</span>
    </li>
  );
}

export function AppraisalSummaryDialog({
  open, onOpenChange, onConfirm, submitting,
  profile, period, supervisorName, targets, self, signedAt, totals,
}: Props) {
  const rating = classify(totals.pct);
  const weightOk = totals.weight === 100;
  const targetsOk = targets.length >= 1 && targets.every((t) => t.target.trim() && t.indicator.trim());
  const supOk = !!supervisorName;
  const signedOk = !!signedAt;
  const canSubmit = weightOk && targetsOk && supOk;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Confirm your appraisal submission</DialogTitle>
          <DialogDescription>
            Review the information below. Once submitted, your supervisor is notified and the appraisal locks for editing.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[65vh] pr-3">
          <div className="space-y-5 text-sm">
            {/* Validation checklist */}
            <section className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pre-submission checklist</div>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                <Check ok={targetsOk} label="Performance targets entered with indicators" />
                <Check ok={weightOk} label={`Weights total 100% (currently ${totals.weight}%)`} />
                <Check ok={supOk} label="Supervisor selected" />
                <Check ok={signedOk} label="Employee signature captured (recommended)" />
              </ul>
            </section>

            {/* Employment */}
            <section>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Employment</div>
              <div className="mt-1 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div><div className="text-muted-foreground">Name</div><div className="font-medium">{profile?.full_name ?? "—"}</div></div>
                <div><div className="text-muted-foreground">Designation</div><div className="font-medium">{profile?.designation ?? "—"}</div></div>
                <div><div className="text-muted-foreground">Department</div><div className="font-medium">{profile?.department ?? "—"}</div></div>
                <div><div className="text-muted-foreground">Emp. no.</div><div className="font-medium">{profile?.employee_no ?? "—"}</div></div>
                <div><div className="text-muted-foreground">Period</div><div className="font-medium">{period}</div></div>
                <div className="col-span-2"><div className="text-muted-foreground">Supervisor</div><div className="font-medium">{supervisorName ?? <span className="text-destructive">Not selected</span>}</div></div>
              </div>
            </section>

            {/* Targets */}
            <section>
              <div className="flex items-baseline justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Performance targets</div>
                <div className="text-xs">Total weight: <span className={weightOk ? "font-semibold" : "font-semibold text-destructive"}>{totals.weight}%</span></div>
              </div>
              {targets.length === 0 ? (
                <p className="mt-2 rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">No targets added.</p>
              ) : (
                <table className="mt-2 w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr><th className="py-1">#</th><th>Target</th><th>Indicator</th><th className="text-right">Weight</th><th className="text-right">Score</th></tr>
                  </thead>
                  <tbody>
                    {targets.map((t, i) => (
                      <tr key={i} className="border-t border-border align-top">
                        <td className="py-1.5">{i + 1}</td>
                        <td className="py-1.5">{t.target || <span className="text-destructive">missing</span>}</td>
                        <td className="py-1.5">{t.indicator || <span className="text-destructive">missing</span>}</td>
                        <td className="py-1.5 text-right">{t.weight}%</td>
                        <td className="py-1.5 text-right">{t.score || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {/* Self-reflection */}
            <section>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Self-appraisal</div>
              <dl className="mt-1 space-y-2 text-xs">
                {([
                  ["Resources needed", self.resources_needed],
                  ["Recommendations", self.recommendations],
                  ["Training needs", self.training_needs],
                  ["Additional comments", self.additional],
                ] as const).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="whitespace-pre-wrap">{v?.trim() ? v : <span className="text-muted-foreground">—</span>}</dd>
                  </div>
                ))}
              </dl>
            </section>

            {/* Score */}
            <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Live weighted score</div>
                <div className="font-display text-2xl font-bold">{totals.pct != null ? `${totals.pct.toFixed(1)}%` : "—"}</div>
              </div>
              <RatingBadge rating={rating ?? undefined} score={totals.pct ?? undefined} />
            </section>

            {!canSubmit && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 text-destructive" />
                <div>Fix the items above before submitting.</div>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Back to edit</Button>
          <Button onClick={() => onConfirm()} disabled={!canSubmit || submitting}>
            <Send className="mr-1.5 h-4 w-4" /> {submitting ? "Submitting…" : "Confirm & submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
