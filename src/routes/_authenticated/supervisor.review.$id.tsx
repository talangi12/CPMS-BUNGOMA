import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RatingBadge, classify } from "@/components/RatingBadge";
import { toast } from "sonner";
import { ArrowLeft, Check, X, FileSignature } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { sendEventEmail } from "@/lib/notify.functions";
import { calculateWeightedScore, computeTargetScore, parseNumericValue } from "@/lib/appraisal-scoring";
import { supabase } from "@/integrations/supabase/client";
import { getSupervisorReview, reopenSupervisorAppraisal, reviewSupervisorAppraisal, updateSupervisorNotes } from "@/lib/appraisal.functions";

export const Route = createFileRoute("/_authenticated/supervisor/review/$id")({
  head: () => ({ meta: [{ title: "Review Appraisal — Bungoma CPMS" }] }),
  component: ReviewAppraisal,
});

function ReviewAppraisal() {
  const { user } = Route.useRouteContext();
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const sendNotifyFn = useServerFn(sendEventEmail);
  const reopenFn = useServerFn(reopenSupervisorAppraisal);
  const fetchReview = useServerFn(getSupervisorReview);
  const reviewAppraisalFn = useServerFn(reviewSupervisorAppraisal);
  const saveNotesFn = useServerFn(updateSupervisorNotes);
  const [reason, setReason] = useState("");
  const [comments, setComments] = useState("");
  const [finalRec, setFinalRec] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<Record<string, Record<string, unknown>>>({});
  const [modReason, setModReason] = useState("");

  function updateField(targetId: string, field: string, value: unknown) {
    setEdits((e) => ({ ...e, [targetId]: { ...(e[targetId] ?? {}), [field]: value } }));
  }

  async function saveEdits() {
    const keys = Object.keys(edits);
      const commentsChanged = comments.trim() !== (data?.appraisal?.supervisor_comments ?? "");
      const finalRecChanged = finalRec.trim() !== (data?.appraisal?.supervisor_final_recommendation ?? "");
      // If editing an already-approved appraisal, a reason is mandatory
      if (a.status === "approved" && modReason.trim().length < 10) {
        toast.error("Provide a reason (min 10 characters) for modifying an approved appraisal.");
        return;
      }
      if (keys.length === 0 && !commentsChanged && !finalRecChanged) { setEditing(false); return; }
      setBusy(true);
      try {
        const snap = { appraisal: data?.appraisal, targets: data?.appraisal?.targets };
        const { count } = await supabase.from("appraisal_versions").select("id", { count: "exact", head: true }).eq("appraisal_id", id);
        await supabase.from("appraisal_versions").insert({
          appraisal_id: id, version_no: (count ?? 0) + 1,
          snapshot: snap as never, changed_by: user.id,
          change_summary: `Supervisor edited ${keys.length} target(s)${commentsChanged ? ", notes" : ""}${finalRecChanged ? ", recommendation" : ""}`,
        });

        const currentTargets = [...(data?.appraisal?.targets ?? [])].sort((x, y) => x.sort_order - y.sort_order);
        for (const tid of keys) {
          const patch = edits[tid] as Record<string, unknown>;
          const dbPatch: Record<string, unknown> = {};
          if (patch.expected_outcome !== undefined) dbPatch.expected_outcome = patch.expected_outcome;
          if (Object.keys(dbPatch).length > 0) {
            const { error } = await supabase.from("targets").update(dbPatch as never).eq("id", tid);
            if (error) throw error;
          }
        }

        const overlayTargets = currentTargets.map((target) => ({
          weight: Number(target.weight) || 0,
          score: parseNumericValue(target.score),
        }));
        const { totalWeight, pct } = calculateWeightedScore(overlayTargets);

        const appraisalPatch: Record<string, unknown> = {
          total_score: pct,
          rating: classify(pct),
        };
        if (commentsChanged) appraisalPatch.supervisor_comments = comments.trim() || null;
        if (finalRecChanged) appraisalPatch.supervisor_final_recommendation = finalRec.trim() || null;
        if (a.status === "approved") appraisalPatch.supervisor_reviewed_at = new Date().toISOString();

        const { error: appraisalError } = await supabase.from("appraisals").update(appraisalPatch as never).eq("id", id);
        if (appraisalError) throw appraisalError;

        // Record audit entry when editing an approved appraisal
        if (a.status === "approved") {
          try {
            const { data: prev } = await supabase.from("appraisals").select("total_score, rating").eq("id", id).maybeSingle();
            await supabase.from("audit_logs").insert({
              action: "appraisal_supervisor_edit",
              entity_type: "appraisal",
              entity_id: id,
              new_values: { total_score: pct, rating: classify(pct) },
              old_values: { total_score: prev?.total_score ?? null, rating: prev?.rating ?? null },
              metadata: { reason: modReason.trim(), changed_by: user.id },
            } as any);
          } catch (e) {
            console.warn("[saveEdits] audit insert failed", e);
          }
        }

        toast.success("Saved with version snapshot");
        setEdits({}); setEditing(false);
        qc.invalidateQueries({ queryKey: ["review", id] });
        qc.invalidateQueries({ queryKey: ["appraisal", data?.appraisal?.employee_id] });
        qc.invalidateQueries({ queryKey: ["dashboard", data?.appraisal?.employee_id] });
      } catch (e) { toast.error(e instanceof Error ? e.message : "Save failed"); }
      finally { setBusy(false); }
    }
  const { data, error, isLoading } = useQuery({
    queryKey: ["review", id],
    enabled: Boolean(id),
    queryFn: async () => {
      return fetchReview({ data: { appraisalId: id } });
    },
  });

  useEffect(() => {
    if (data?.appraisal?.supervisor_comments) setComments(data.appraisal.supervisor_comments);
    if (data?.appraisal?.supervisor_final_recommendation) setFinalRec(data.appraisal.supervisor_final_recommendation);
  }, [data]);

  if (isLoading) return <Shell userId={user.id}><div className="p-10 text-center text-sm text-muted-foreground">Loading…</div></Shell>;
  if (error) return <Shell userId={user.id}><Card className="p-10 text-center"><p>{error instanceof Error ? error.message : "Failed to load appraisal."}</p></Card></Shell>;
  if (!data?.appraisal) return <Shell userId={user.id}><Card className="p-10 text-center"><p>Appraisal not found.</p></Card></Shell>;

  const a = data.appraisal;
  const targets = [...(a.targets ?? [])].sort((x, y) => x.sort_order - y.sort_order);
  const overlayTargets = targets.map((target) => {
    const patch = edits[target.id] as Record<string, unknown> | undefined;
    const score = computeTargetScore(
      patch?.indicator ?? target.indicator,
      patch?.achieved_result ?? target.achieved_result,
    ).score ?? parseNumericValue(target.score);
    return { weight: Number(patch?.weight ?? target.weight) || 0, score };
  });
  const { totalWeight, pct } = calculateWeightedScore(overlayTargets);
  const rating = classify(pct);

  const isFinal = a.status === "approved" || a.status === "rejected";

  // Show approval confirmation screen if approved and not in edit mode
  if (isFinal && a.status === "approved" && !editing) {
    return (
      <Shell userId={user.id}>
        <div className="mb-4">
          <Link to="/supervisor/inbox" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3 w-3" /> Back to inbox
          </Link>
        </div>
        <Card className="p-8 text-center">
          <div className="text-xs font-semibold uppercase tracking-widest text-primary">Appraisal review completed</div>
          <div className="mt-4 text-3xl font-display font-bold">You have approved {data.profile?.full_name}'s appraisal</div>
          <p className="mt-3 text-sm text-muted-foreground">
            Reviewed on {a.supervisor_reviewed_at ? new Date(a.supervisor_reviewed_at).toLocaleString() : "—"}
          </p>
          <div className="mt-6 inline-flex gap-3">
            <Button variant="outline" onClick={() => setEditing(true)}>
              Edit & Re-review
            </Button>
            <Button variant="ghost" onClick={async () => {
              if (!confirm("Reopen appraisal for appraisee edits?")) return;
              setBusy(true);
              try {
                await reopenFn({ data: { appraisalId: id, reason: "Supervisor reopened for edits" } });
                toast.success("Appraisal reopened for edits");
                qc.invalidateQueries({ queryKey: ["review", id] });
                qc.invalidateQueries({ queryKey: ["appraisal", data?.appraisal?.employee_id] });
                navigate({ to: "/supervisor/inbox" });
              } catch (e) { toast.error(e instanceof Error ? e.message : "Failed to reopen"); }
              finally { setBusy(false); }
            }}>
              Reopen
            </Button>
            <Link to="/supervisor/inbox">
              <Button>Back to inbox</Button>
            </Link>
          </div>
        </Card>
      </Shell>
    );
  }


  async function decide(action: "approved" | "rejected" | "approved_initial") {
    if (action === "rejected" && reason.trim().length < 10) {
      toast.error("Return requires mandatory comments (min 10 characters) describing the corrections needed.");
      return;
    }
    setBusy(true);
    try {
      console.log("[decide] Calling approval with:", {
        appraisalId: id,
        action,
        supervisorComments: comments.trim() || null,
        totalScore: pct,
        rating: classify(pct),
      });
      await reviewAppraisalFn({ data: {
        appraisalId: id,
        action,
        rejectionReason: action === "rejected" ? reason.trim() : null,
        supervisorComments: comments.trim() || null,
        supervisorFinalRecommendation: finalRec.trim() || null,
        totalScore: pct,
        rating: classify(pct),
      }});
      console.log("[decide] Approval call succeeded");
      // Fire-and-forget email; failure is silently audit-logged in notification_log
      try {
        await sendNotifyFn({ data: {
          event_type: action === "approved" ? "appraisal_approved" : "appraisal_rejected",
          to_user_id: a.employee_id,
          related_appraisal_id: id,
          vars: { period: a.period ?? "", reason: reason.trim(), score: String(pct ?? ""), rating: String(classify(pct) ?? "") },
        }});
      } catch { /* logged server-side */ }
      toast.success(action === "approved" ? "Appraisal approved" : action === "approved_initial" ? "Appraisal initial approval recorded" : "Appraisal returned for revision");
      qc.invalidateQueries({ queryKey: ["review", id] });
      qc.invalidateQueries({ queryKey: ["supervisor-inbox", user.id] });
      qc.invalidateQueries({ queryKey: ["appraisal", data?.appraisal?.employee_id] });
      navigate({ to: "/supervisor/inbox" });
    } catch (e: unknown) {
      console.error("[decide] Error caught:", e);
      const errorMessage = e instanceof Error ? e.message : JSON.stringify(e);
      console.error("[decide] Error message:", errorMessage);
      toast.error(`Action failed: ${errorMessage}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell userId={user.id}>
      <div className="mb-4">
        <Link to="/supervisor/inbox" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Back to inbox
        </Link>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-primary">Reviewing {a.period}</div>
          <h1 className="mt-2 font-display text-3xl font-bold">{data.profile?.full_name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.profile?.designation} · {data.profile?.department} · Emp. {data.profile?.employee_no}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-wider">{a.status}</span>
          <RatingBadge rating={rating ?? undefined} score={pct ?? undefined} />
          {/* Supervisor sign fields visible immediately when appraisal is submitted */}
          {(a.status === "submitted" || editing) && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Supervisor comments</Label>
                <Textarea value={comments} onChange={(e) => setComments(e.target.value)} className="mt-1" disabled={isFinal && !editing} />
              </div>
              <div>
                <Label>Final recommendation</Label>
                <Textarea value={finalRec} onChange={(e) => setFinalRec(e.target.value)} className="mt-1" disabled={isFinal && !editing} />
              </div>
              <div className="sm:col-span-2 mt-2">
                <div className="flex gap-2">
                  <Button disabled={busy} onClick={saveEdits}>
                    Save notes
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      

      <Card className="mt-6 p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">Performance targets ({targets.length})</h2>
          <Button size="sm" variant="outline" onClick={() => setEditing((v) => !v)} disabled={a.status === "submitted"}>{editing ? "Stop editing" : "Edit targets"}</Button>
        </div>
        <p className="text-sm text-muted-foreground">Total weight: <span className={totalWeight === 100 ? "text-primary font-semibold" : "text-destructive font-semibold"}>{totalWeight}%</span></p>
        <div className="mt-4 space-y-3">
          {targets.map((t, i) => (
            <div key={t.id} className="rounded-lg border border-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-primary">Target {i + 1}</div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Weight</span>
                  <span className="font-semibold">{t.weight}%</span>
                  <span className="ml-2 text-muted-foreground">Score</span>
                  <span className="font-semibold">{t.score ?? 0}</span>
                </div>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Detail label="Target" value={t.target} />
                <Detail label="Indicator" value={t.indicator} />
                <EditableDetail label="Expected outcome" value={t.expected_outcome} editing={editing} onChange={(v) => updateField(t.id, "expected_outcome", v)} />
                <Detail label="Achieved result" value={t.achieved_result} />
              </div>
            </div>
          ))}
        </div>
        {editing && (
          <div className="mt-4 flex justify-end">
            <Button size="sm" onClick={saveEdits} disabled={busy}>Save expected outcome changes</Button>
          </div>
        )}
      </Card>

      <Card className="mt-6 p-6">
        <h2 className="font-display text-lg font-bold">Your review</h2>
        <div className="mt-4 grid gap-4">
          <div>
            <Label className="mb-1.5 block text-xs">Overall comments / recommendations</Label>
            <Textarea rows={3} value={comments} onChange={(e) => setComments(e.target.value)} placeholder="Constructive feedback…" disabled={isFinal} />
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">Final recommendation (Promotion / Retention / Training / Counselling …)</Label>
            <Textarea rows={2} value={finalRec} onChange={(e) => setFinalRec(e.target.value)} placeholder="Recommended next step for this employee" disabled={isFinal} />
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">
              Required when returning: list sections needing correction and explain changes
            </Label>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Target 3: indicator unclear — quantify the percentage improvement expected. Target 4: weight too low for this strategic objective." disabled={isFinal} />
          </div>
        </div>

        {a.rejection_reason && (
          <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-destructive">Previous return comments</div>
            <p className="mt-1 whitespace-pre-wrap">{a.rejection_reason}</p>
            <div className="mt-2 text-[11px] text-muted-foreground">
              Returned {a.returns_count ?? 0} time(s) · Resubmitted {a.resubmissions_count ?? 0} time(s)
            </div>
          </div>
        )}

        {!isFinal ? (
          <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => decide("rejected")} disabled={busy}>
                <X className="mr-1.5 h-4 w-4" /> Return for corrections
              </Button>
              <Button onClick={() => decide("approved_initial")} disabled={busy}>
                <Check className="mr-1.5 h-4 w-4" /> Approve initial & move to Continuous Review
              </Button>
              <Button onClick={() => decide("approved")} disabled={busy}>
                <Check className="mr-1.5 h-4 w-4" /> Approve & finalize
              </Button>
            </div>
        ) : (
          <div className="mt-6 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
            <FileSignature className="h-4 w-4 text-primary" />
            <span>
              You {a.status} this appraisal{a.supervisor_reviewed_at ? ` on ${new Date(a.supervisor_reviewed_at).toLocaleString()}` : ""}. Appraisal is now locked.
            </span>
          </div>
        )}
      </Card>
    </Shell>
  );
}


function EditableDetail({ label, value, editing, onChange }: { label: string; value: string | null; editing: boolean; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      {editing ? (
        <input defaultValue={value ?? ""} className="mt-0.5 w-full rounded border border-border px-2 py-1 text-sm" onChange={(e) => onChange(e.target.value)} />
      ) : (
        <div className="mt-0.5 text-sm">{value || <span className="text-muted-foreground">—</span>}</div>
      )}
    </div>
  );
}

function EditableNumericDetail({ label, value, editing, onChange }: { label: string; value: string | null; editing: boolean; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      {editing ? (
        <input type="number" step="any" defaultValue={value ?? ""} className="mt-0.5 w-full rounded border border-border px-2 py-1 text-sm" onChange={(e) => onChange(e.target.value)} />
      ) : (
        <div className="mt-0.5 text-sm">{value || <span className="text-muted-foreground">—</span>}</div>
      )}
    </div>
  );
}

function Shell({ children, userId }: { children: React.ReactNode; userId: string }) {
  return (
    <div className="min-h-screen bg-background">
      <AppHeader authenticated userId={userId} />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">{children}</main>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm">{value || <span className="text-muted-foreground">—</span>}</div>
    </div>
  );
}
