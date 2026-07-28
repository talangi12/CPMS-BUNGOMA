import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { RatingBadge, classify } from "@/components/RatingBadge";
import { toast } from "sonner";
import { Plus, Trash2, FileSignature, Save, Send, AlertCircle, CheckCircle2, FileDown, Gavel, ShieldAlert, Lock, Sparkles } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { generateAppraisalPdf, getAppraisalPdfUrl } from "@/lib/pdf.functions";
import { generateAppraisalReport, getLatestAppraisalReport } from "@/lib/ai-report.functions";
import { Link } from "@tanstack/react-router";
import { useRoles, type AppRole } from "@/hooks/useRoles";
import { AppraisalCalendar } from "@/components/AppraisalCalendar";
import { ContractSignoffTracker } from "@/components/ContractSignoffTracker";
import { AppraisalTimeline } from "@/components/AppraisalTimeline";
import { AppraisalSummaryDialog } from "@/components/AppraisalSummaryDialog";
import { calculateWeightedScore, computeTargetScore, parseNumericValue } from "@/lib/appraisal-scoring";

export const Route = createFileRoute("/_authenticated/appraisal")({
  head: () => ({ meta: [{ title: "My Appraisal — Bungoma CPMS" }] }),
  component: AppraisalPage,
});

type TargetRow = {
  id?: string;
  target: string;
  indicator: string;
  weight: number;
  expected_outcome: string;
  achieved_result: string;
  score: number | null;
  sort_order: number;
};

type SelfReflection = {
  resources_needed: string;
  recommendations: string;
  training_needs: string;
  additional: string;
};

const EMPTY_SELF: SelfReflection = {
  resources_needed: "", recommendations: "", training_needs: "", additional: "",
};

const period = `FY ${new Date().getFullYear()}/${(new Date().getFullYear() + 1).toString().slice(-2)}`;

type SignatureSlot = { name?: string; signed_at?: string };
type CycleSignoffs = {
  governor?: SignatureSlot;
  cec?: SignatureSlot;
  chief_officer?: SignatureSlot;
  director?: SignatureSlot;
  appraisee?: SignatureSlot;
  supervisor?: SignatureSlot;
  director_endorsement?: SignatureSlot;
};

function AppraisalPage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const [appraisalId, setAppraisalId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Record<string, string | null> | null>(null);
  const [status, setStatus] = useState<string>("draft");
  const [signedAt, setSignedAt] = useState<string | null>(null);
  const [supervisorId, setSupervisorId] = useState<string>("");
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [supervisorComments, setSupervisorComments] = useState<string | null>(null);
  const [supervisorReviewedAt, setSupervisorReviewedAt] = useState<string | null>(null);
  const [targets, setTargets] = useState<TargetRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [selfCommitments, setSelfCommitments] = useState("");
  const [selfReflection, setSelfReflection] = useState<SelfReflection>(EMPTY_SELF);
  const [signoffs, setSignoffs] = useState<CycleSignoffs>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { data: myRoles } = useRoles(user.id);

  const { data, isLoading } = useQuery({
    queryKey: ["appraisal", user.id],
    queryFn: async () => {
      const { data: prof } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
      const { data: existing } = await supabase
        .from("appraisals")
        .select("*, targets(*)")
        .eq("employee_id", user.id)
        .eq("period", period)
        .maybeSingle();
      const dept = prof?.department ?? "";
      const { data: sups } = await supabase.rpc("list_supervisors_for_dept", { _dept: dept });
      const { data: cycleActive } = dept
        ? await supabase.rpc("cycle_active_for_dept", { _dept: dept })
        : { data: null };
      const { data: workplans } = await supabase.from("workplans")
        .select("*").eq("assignee_id", user.id)
        .order("created_at", { ascending: false });
      return {
        profile: prof,
        existing,
        supervisors: (sups ?? []) as Array<{ id: string; full_name: string; designation: string | null; department: string | null; directorate: string | null; photo_url: string | null }>,
        cycleActive: cycleActive === true,
        workplans: workplans ?? [],
      };
    },
  });

  useEffect(() => {
    if (!data) return;
    setProfile(data.profile as unknown as Record<string, string | null> | null);
    if (data.existing) {
      setAppraisalId(data.existing.id);
      setStatus(data.existing.status);
      setSignedAt(data.existing.employee_signed_at);
      setSupervisorId(data.existing.chosen_supervisor_id ?? "");
      setRejectionReason(data.existing.rejection_reason ?? null);
      setSupervisorComments(data.existing.supervisor_comments ?? null);
      setSupervisorReviewedAt(data.existing.supervisor_reviewed_at ?? null);
      setSelfCommitments(data.existing.self_commitments ?? "");
      const ex = data.existing as unknown as Record<string, string | null>;
      setSelfReflection({
        resources_needed: ex.self_resources_needed ?? "",
        recommendations: ex.self_recommendations ?? "",
        training_needs: ex.self_training_needs ?? "",
        additional: ex.self_additional ?? "",
      });
      setSignoffs((data.existing.cycle_signoffs as CycleSignoffs) ?? {});
      const sorted = [...(data.existing.targets ?? [])].sort((a, b) => a.sort_order - b.sort_order);
      setTargets(sorted.map((t) => ({
        id: t.id,
        target: t.target ?? "",
        indicator: t.indicator ?? "",
        weight: Number(t.weight) || 0,
        expected_outcome: t.expected_outcome ?? "",
        achieved_result: t.achieved_result ?? "",
        score: parseNumericValue(t.score),
        sort_order: t.sort_order,
      })));
    } else if (targets.length === 0) {
      setTargets([blankTarget(0)]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const totals = useMemo(() => {
    const { totalWeight, pct } = calculateWeightedScore(targets.map((t) => ({ weight: t.weight, score: t.score })));
    return { weight: totalWeight, pct, rating: classify(pct) };
  }, [targets]);

  const locked = status === "submitted" || status === "approved";
  const signoffLocked = false;

  function blankTarget(order: number): TargetRow {
    return { target: "", indicator: "", weight: 0, expected_outcome: "", achieved_result: "", score: null, sort_order: order };
  }
  function updateTarget(i: number, patch: Partial<TargetRow>) {
    setTargets((prev) => prev.map((t, idx) => {
      if (idx !== i) return t;
      const next = { ...t, ...patch };
      if ("indicator" in patch || "achieved_result" in patch) {
        const computed = computeTargetScore(next.indicator, next.achieved_result);
        return { ...next, score: computed.score ?? null };
      }
      return next;
    }));
  }

  function validateTargets(): string | null {
    const issues = targets.flatMap((t, idx) => {
      const targetValue = parseNumericValue(t.indicator);
      const achievedValue = parseNumericValue(t.achieved_result);
      if (t.target.trim() === "") return [];
      if (targetValue == null) {
        return [{ idx, message: `Target ${idx + 1}: enter a numeric performance indicator.` }];
      }
      if (targetValue === 0) {
        return [{ idx, message: `Target ${idx + 1}: target value cannot be zero.` }];
      }
      if (t.achieved_result.trim() !== "" && achievedValue == null) {
        return [{ idx, message: `Target ${idx + 1}: achieved result must be numeric when provided.` }];
      }
      return [];
    });
    return issues[0]?.message ?? null;
  }

  async function ensureAppraisal(): Promise<string> {
    if (appraisalId) return appraisalId;
    const { data: created, error } = await supabase
      .from("appraisals")
      .insert({ employee_id: user.id, period, status: "draft", chosen_supervisor_id: supervisorId || null })
      .select()
      .single();
    if (error) throw error;
    setAppraisalId(created.id);
    return created.id;
  }

  async function saveAll(submit = false) {
    if (submit && !supervisorId) {
      toast.error("Choose the supervisor who will appraise you before submitting.");
      return;
    }
    if (submit && totals.weight !== 100) {
      toast.error("Target weights must sum to exactly 100% before submission.");
      return;
    }
    const validationError = validateTargets();
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setSaving(true);
    try {
      const id = await ensureAppraisal();

      const existingIds = (data?.existing?.targets ?? []).map((t: { id: string }) => t.id);
      const keptIds = targets.map((t) => t.id).filter(Boolean) as string[];
      const toDelete = existingIds.filter((eid: string) => !keptIds.includes(eid));
      if (toDelete.length) await supabase.from("targets").delete().in("id", toDelete);

      for (const [i, t] of targets.entries()) {
        const computed = computeTargetScore(t.indicator, t.achieved_result);
        const payload = {
          appraisal_id: id, target: t.target, indicator: t.indicator, weight: t.weight,
          expected_outcome: t.expected_outcome, achieved_result: t.achieved_result, score: computed.score ?? null, sort_order: i,
        };
        if (t.id) await supabase.from("targets").update(payload).eq("id", t.id);
        else {
          const { data: ins } = await supabase.from("targets").insert(payload).select().single();
          if (ins) t.id = ins.id;
        }
      }

      const newStatus = submit ? "submitted" : status === "rejected" ? "draft" : status;
      await supabase.from("appraisals").update({
        status: newStatus,
        total_score: totals.pct,
        rating: totals.rating,
        chosen_supervisor_id: supervisorId || null,
        rejection_reason: submit ? null : rejectionReason,
        self_commitments: selfCommitments || null,
        self_resources_needed: selfReflection.resources_needed || null,
        self_recommendations: selfReflection.recommendations || null,
        self_training_needs: selfReflection.training_needs || null,
        self_additional: selfReflection.additional || null,
        cycle_signoffs: signoffs as never,
      } as never).eq("id", id);

      setStatus(newStatus);
      if (submit) setRejectionReason(null);
      toast.success(submit ? "Submitted to your supervisor" : "Draft saved");
      qc.invalidateQueries({ queryKey: ["appraisal", user.id] });
      qc.invalidateQueries({ queryKey: ["dashboard", user.id] });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function signEmployee() {
    const id = await ensureAppraisal();
    const ts = new Date().toISOString();
    const next = { ...signoffs, appraisee: { name: profile?.full_name ?? "Appraisee", signed_at: ts } };
    setSignoffs(next);
    await supabase.from("appraisals").update({
      employee_signed_at: ts,
      cycle_signoffs: next as never,
    }).eq("id", id);
    setSignedAt(ts);
    toast.success("Target agreement signed");
    qc.invalidateQueries({ queryKey: ["appraisal", user.id] });
  }

  async function recordSignoff(slot: keyof CycleSignoffs, name: string) {
    const signerName = (name || profile?.full_name || user.email || "Signer").trim();
    if (!signerName) return toast.error("Enter a name");
    const id = await ensureAppraisal();
    const next = { ...signoffs, [slot]: { name: signerName, signed_at: new Date().toISOString() } };
    setSignoffs(next);
    await supabase.from("appraisals").update({ cycle_signoffs: next as never }).eq("id", id);
    toast.success("Signature recorded");
  }

  if (isLoading) return <div className="min-h-screen"><AppHeader authenticated userId={user.id} /><div className="p-10 text-center text-muted-foreground">Loading appraisal…</div></div>;

  return (
    <div className="min-h-screen bg-background pb-24">
      <AppHeader authenticated userId={user.id} />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 space-y-6">
        <ContractSignoffTracker userId={user.id} />
        <AppraisalCalendar userId={user.id} />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-primary">Staff Performance Appraisal — {period}</div>
            <h1 className="mt-2 font-display text-3xl font-bold">My Appraisal</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-wider">{status}</span>
            <RatingBadge rating={totals.rating ?? undefined} score={totals.pct ?? undefined} />
          </div>
        </div>

        {/* Cycle activation banner */}
        {data && !data.cycleActive && (
          <div className="mt-6 rounded-lg border border-gold/50 bg-gold/10 p-4">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-4 w-4 text-gold-foreground" />
              <div className="text-sm">
                <div className="font-semibold">Appraisal cycle not yet active for {profile?.department || "your department"}</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  The cycle becomes active once the Governor signs and your Chief Officer, Director and Supervisor endorse the cycle for your department. You can draft your targets, but submission is locked until activation completes.
                </p>
              </div>
            </div>
          </div>
        )}
        {data && data.cycleActive && status === "draft" && (
          <div className="mt-6 rounded-lg border border-primary/40 bg-primary/5 p-4 text-sm">
            <div className="flex items-center gap-2 text-primary">
              <CheckCircle2 className="h-4 w-4" />
              <span className="font-semibold">Cycle active for {profile?.department}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">You may submit your targets to your supervisor for approval.</p>
          </div>
        )}

        {/* Status banners */}
        {status === "rejected" && rejectionReason && (
          <div className="mt-6 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 text-destructive" />
              <div>
                <div className="font-semibold text-destructive">Returned for revision</div>
                <p className="mt-1 text-sm">{rejectionReason}</p>
                <p className="mt-2 text-xs text-muted-foreground">Make changes and resubmit when ready. Saving will return this appraisal to draft.</p>
              </div>
            </div>
          </div>
        )}
        {status === "approved" && (
          <div className="mt-6 rounded-lg border border-primary/40 bg-primary/5 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
                <div>
                  <div className="font-semibold text-primary">Approved by your supervisor</div>
                  {supervisorComments && <p className="mt-1 text-sm">{supervisorComments}</p>}
                  {supervisorReviewedAt && <p className="mt-1 text-xs text-muted-foreground">on {new Date(supervisorReviewedAt).toLocaleString()}</p>}
                </div>
              </div>
              <PdfActions appraisalId={appraisalId} />
            </div>
          </div>
        )}
        {status === "rejected" && (
          <div className="mt-3 text-xs">
            <Link to="/appeals" className="inline-flex items-center gap-1 text-primary underline"><Gavel className="h-3 w-3" /> File an appeal</Link>
          </div>
        )}
        {status === "submitted" && (
          <div className="mt-6 rounded-lg border border-gold/40 bg-gold/10 p-4 text-sm">
            Awaiting supervisor review. You'll be notified when there's an update.
          </div>
        )}

        {/* Chronological history of every action taken on this appraisal */}
        <AppraisalTimeline appraisalId={appraisalId} />

        {/* SECTION 1 */}
        <Card className="mt-6 p-6">
          <SectionHeader number="1" title="Employment Details" />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <ReadOnly label="Name" value={profile?.full_name} />
            <ReadOnly label="Personal Number" value={profile?.employee_no} />
            <ReadOnly label="Designation" value={profile?.designation} />
            <ReadOnly label="Job Group" value={profile?.job_group} />
            <ReadOnly label="Department" value={profile?.department} />
            <ReadOnly label="Directorate" value={profile?.directorate} />
            <ReadOnly label="Work Station" value={profile?.work_station} />
            <ReadOnly label="Email" value={profile?.email} />
          </div>
        </Card>

        {/* ASSIGNED WORKPLAN — integrated directly under Employment Details */}
        <Card className="mt-6 p-6">
          <SectionHeader number="1B" title="Assigned Workplan" />
          <p className="mt-2 text-sm text-muted-foreground">
            Workplan items assigned to you by your supervisor or higher-level officer. These flow into your performance targets below.
          </p>
          <div className="mt-4 space-y-3">
            {(data?.workplans ?? []).length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                No workplan items assigned yet. Your supervisor will assign these at the start of the cycle.
              </div>
            ) : (
              (data?.workplans ?? []).map((w) => (
                <div key={w.id} className="rounded-lg border border-border bg-muted/20 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                        <span>{w.strategic_objective || "Strategic objective"}</span>
                        <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-semibold">
                          {w.workplan_type === "quarterly" ? `Quarter ${w.quarter ?? "?"}` : "Annual"}
                        </span>
                        {w.reporting_period && <span className="text-[10px]">· {w.reporting_period}</span>}
                        <span className="text-[10px]">· v{w.version ?? 1}</span>
                      </div>
                      <div className="mt-1 font-medium">{w.activity}</div>
                    </div>
                    {w.approved_at ? (
                      <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase text-emerald-700">Approved · locked</span>
                    ) : (
                      <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase text-amber-700">Pending approval</span>
                    )}
                  </div>
                  <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
                    {w.kpi && <div><span className="text-xs text-muted-foreground">Performance Indicator</span><div>{w.kpi}</div></div>}
                    {w.target_value !== null && <div><span className="text-xs text-muted-foreground">Individual Target</span><div>{String(w.target_value)}</div></div>}
                    {w.timeline && <div><span className="text-xs text-muted-foreground">Time Frame</span><div>{w.timeline}</div></div>}
                    {w.resources_required && <div className="sm:col-span-3"><span className="text-xs text-muted-foreground">Resources Required</span><div>{w.resources_required}</div></div>}
                  </div>
                  {w.expected_deliverable && <p className="mt-2 text-xs text-muted-foreground">Expected: {w.expected_deliverable}</p>}
                  {w.document_path && (
                    <button
                      type="button"
                      onClick={async () => {
                        const { data: sig, error } = await supabase.storage.from("workplan-documents").createSignedUrl(w.document_path as string, 600);
                        if (error || !sig?.signedUrl) { toast.error(error?.message ?? "Could not open document"); return; }
                        window.open(sig.signedUrl, "_blank");
                      }}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10"
                    >
                      📎 {w.document_name ?? "Attached workplan"} — View / Download
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </Card>

        {/* SUPERVISOR PICKER — department-scoped, card UI with avatars/placeholders */}
        <Card className="mt-6 p-6">
          <SectionHeader number="★" title="Choose your appraising supervisor" />
          <p className="mt-2 text-sm text-muted-foreground">
            Only supervisors registered to <strong>{profile?.department || "your department"}</strong> are shown. The supervisor you pick will receive your appraisal for review, approval, and sign-off.
          </p>
          <div className="mt-4">
            {(data?.supervisors ?? []).length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                No supervisors registered for {profile?.department || "your department"} yet. Ask a System Administrator to assign the Supervisor role.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {(data?.supervisors ?? []).map((s) => (
                  <SupervisorCard
                    key={s.id}
                    sup={s}
                    selected={supervisorId === s.id}
                    disabled={locked}
                    onSelect={() => !locked && setSupervisorId(s.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </Card>

        {/* SECTION 2A */}
        <Card className="mt-6 p-6">
          <div className="flex items-start justify-between gap-4">
            <SectionHeader number="2A" title="Performance Targets" />
            <div className="text-right text-sm">
              <div className="text-muted-foreground">Total weight</div>
              <div className={`font-display text-2xl font-bold ${totals.weight === 100 ? "text-primary" : "text-destructive"}`}>{totals.weight}%</div>
            </div>
          </div>

          <div className="mt-4 space-y-4">
            {targets.map((t, i) => (
              <div key={i} className="rounded-lg border border-border bg-muted/30 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wider text-primary">Target {i + 1}</div>
                  {!locked && (
                    <button onClick={() => setTargets((p) => p.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Agreed performance target"><Textarea disabled={locked} rows={2} value={t.target} onChange={(e) => updateTarget(i, { target: e.target.value })} /></Field>
                    <Field label="Performance indicator (numeric)"><Input disabled={locked} type="number" step="any" value={t.indicator} onChange={(e) => updateTarget(i, { indicator: e.target.value })} /></Field>
                  <Field label="Expected outcome (supervisor sets at review)"><Textarea disabled rows={2} value={t.expected_outcome} placeholder="Filled by your supervisor" /></Field>
                  <Field label="Achieved result (numeric) — supervisor entry only"><Input disabled type="number" step="any" value={t.achieved_result} placeholder="Supervisor fills this after review" /></Field>
                  <Field label="Weight (%)"><Input disabled={locked} type="number" min={0} max={100} value={t.weight} onChange={(e) => updateTarget(i, { weight: Number(e.target.value) })} /></Field>
                  <Field label="Computed score"><Input disabled value={t.score == null ? "" : t.score.toFixed(1)} placeholder="Computed automatically" /></Field>
                </div>
              </div>
            ))}
            {!locked && (
              <Button variant="outline" onClick={() => setTargets((p) => [...p, blankTarget(p.length)])}>
                <Plus className="mr-1.5 h-4 w-4" /> Add target
              </Button>
            )}
          </div>
        </Card>

        {/* SECTION 2B - Self-statement / Commitments at start of cycle */}
        <Card className="mt-6 p-6">
          <SectionHeader number="2B" title="Self-statement & commitments" />
          <p className="mt-2 text-sm text-muted-foreground">
            Before submitting to your supervisor, describe your personal commitments, growth goals and how you intend to meet the targets above.
          </p>
          <div className="mt-4">
            <Label className="mb-1.5 block text-xs">My commitments this cycle</Label>
            <Textarea rows={5} disabled={locked} value={selfCommitments}
              onChange={(e) => setSelfCommitments(e.target.value)}
              placeholder="e.g. I commit to attending two professional development courses, mentoring junior staff…" />
          </div>
        </Card>

        {/* SECTION 2B-II — Structured Self-Appraisal Reflection */}
        <Card className="mt-6 p-6">
          <SectionHeader number="2B-II" title="Self-Appraisal Reflection" />
          <p className="mt-2 text-sm text-muted-foreground">
            Reflective questions that capture what you need, what you achieved, and how to improve. These responses form part of the final appraisal report and are visible to your supervisor during review.
          </p>
          <div className="mt-4 grid gap-4">
            {([
              { key: "resources_needed", title: "Resources and Support Required", prompt: "What resources, tools, equipment, or support do you require to successfully accomplish the responsibilities assigned to you?" },
              { key: "recommendations", title: "Recommendations", prompt: "Provide recommendations that could improve service delivery, departmental performance, or your own effectiveness." },
              { key: "training_needs", title: "Training & Capacity Building Needs", prompt: "Identify any training, mentorship, or professional development opportunities that would enhance your performance." },
              { key: "additional", title: "Additional Comments", prompt: "Any further remarks you'd like to share." },
            ] as const).map(({ key, title, prompt }) => (
              <div key={key}>
                <Label className="mb-1 block text-sm font-semibold">{title}</Label>
                <p className="mb-1.5 text-xs italic text-muted-foreground">{prompt}</p>
                <Textarea rows={3} disabled={locked} value={selfReflection[key]}
                  onChange={(e) => setSelfReflection((s) => ({ ...s, [key]: e.target.value }))} />
              </div>
            ))}
          </div>
        </Card>

        {/* SECTION 2C */}
        <Card className="mt-6 p-6">
          <SectionHeader number="2C" title="Target Agreement Signatures" />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-dashed border-border p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Employee signature</div>
              {signedAt ? (
                <div className="mt-2">
                  <div className="font-display text-lg font-bold italic text-primary">{profile?.full_name}</div>
                  <div className="text-xs text-muted-foreground">Signed {new Date(signedAt).toLocaleString()}</div>
                </div>
              ) : (
                <Button className="mt-2" variant="outline" onClick={signEmployee} disabled={locked}>
                  <FileSignature className="mr-1.5 h-4 w-4" /> Sign digitally
                </Button>
              )}
            </div>
            <div className="rounded-lg border border-dashed border-border p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Supervisor signature</div>
              {status === "approved" && supervisorReviewedAt ? (
                <div className="mt-2">
                  <div className="font-display text-lg font-bold italic text-primary">Approved & signed</div>
                  <div className="text-xs text-muted-foreground">on {new Date(supervisorReviewedAt).toLocaleString()}</div>
                </div>
              ) : (
                <div className="mt-2 text-sm text-muted-foreground">Pending supervisor review</div>
              )}
            </div>
          </div>
        </Card>

        {/* SECTION 2D - Cycle sign-off chains */}
        <Card className="mt-6 p-6">
          <SectionHeader number="2D" title="Cycle sign-off chain" />
          <p className="mt-2 text-sm text-muted-foreground">
            Required signatures before the cycle is formally opened. Top chain authorises county-wide. Bottom chain endorses this individual appraisal.
          </p>

          <div className="mt-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-primary">Authorisation chain</div>
            <p className="mt-1 text-[11px] text-muted-foreground">Each tier may only sign in sequence and only by a user holding that role.</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <SignSlot label="Governor" slot="governor" signoffs={signoffs} onSign={recordSignoff} disabled={signoffLocked}
                canSign={canRoleSign("governor", myRoles, signoffs)} requiredRoleLabel="Governor" fixedName={profile?.full_name ?? undefined} />
              <SignSlot label="CECs" slot="cec" signoffs={signoffs} onSign={recordSignoff} disabled={signoffLocked}
                canSign={canRoleSign("cec", myRoles, signoffs)} requiredRoleLabel="CEC" fixedName={profile?.full_name ?? undefined} />
              <SignSlot label="Chief Officer" slot="chief_officer" signoffs={signoffs} onSign={recordSignoff} disabled={signoffLocked}
                canSign={canRoleSign("chief_officer", myRoles, signoffs)} requiredRoleLabel="Chief Officer" fixedName={profile?.full_name ?? undefined} />
              <SignSlot label="Director" slot="director" signoffs={signoffs} onSign={recordSignoff} disabled={signoffLocked}
                canSign={canRoleSign("director", myRoles, signoffs)} requiredRoleLabel="Director" fixedName={profile?.full_name ?? undefined} />
            </div>
          </div>

          <div className="mt-6">
            <div className="text-xs font-semibold uppercase tracking-wider text-primary">Individual endorsement chain</div>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <SignSlot label="Appraisee" slot="appraisee" signoffs={signoffs} onSign={recordSignoff} disabled={signoffLocked}
                fixedName={profile?.full_name ?? undefined} canSign={true} requiredRoleLabel="Appraisee" />
              <SignSlot label="Supervisor" slot="supervisor" signoffs={signoffs} onSign={recordSignoff} disabled={signoffLocked}
                canSign={!!signoffs.appraisee?.signed_at && (user.id === supervisorId || (myRoles?.includes("director") ?? false))}
                requiredRoleLabel="Assigned supervisor (or Director in your directorate)" />
              <SignSlot label="Director" slot="director_endorsement" signoffs={signoffs} onSign={recordSignoff} disabled={signoffLocked}
                canSign={!!signoffs.supervisor?.signed_at && (myRoles?.includes("director") ?? false)}
                requiredRoleLabel="Director" />
            </div>
          </div>
        </Card>


        {/* Rating Matrix preview */}
        <Card className="mt-6 p-6">
          <SectionHeader number="8" title="Performance Rating Matrix" />
          <p className="mt-2 text-sm text-muted-foreground">Live, weighted score across all targets.</p>
          <div className="mt-4 grid grid-cols-2 gap-3 text-center text-xs sm:grid-cols-5">
            {[["Poor","≤49%"],["Fair","50-64%"],["Good","65-84%"],["Very Good","85-100%"],["Excellent","101%+"]].map(([l, r]) => (
              <div key={l} className={`rounded-lg border p-3 ${totals.rating === l ? "border-primary bg-primary/5" : "border-border bg-muted/30"}`}>
                <div className={`font-display text-sm font-bold ${totals.rating === l ? "text-primary" : ""}`}>{l}</div>
                <div className="text-muted-foreground">{r}</div>
              </div>
            ))}
          </div>
        </Card>

        {/* Final appraisal report (AI) */}
        <FinalReport appraisalId={appraisalId} signoffs={signoffs} />

        {/* Sticky action bar */}
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="text-xs text-muted-foreground">
              {!supervisorId && <span className="text-destructive">Choose a supervisor.</span>}
              {supervisorId && totals.weight !== 100 && <span className="text-destructive">Weights must total 100% to submit.</span>}
              {locked && <span>This appraisal is {status} and read-only.</span>}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => saveAll(false)} disabled={saving || locked}>
                <Save className="mr-1.5 h-4 w-4" /> Save draft
              </Button>
              <Button onClick={() => setConfirmOpen(true)} disabled={saving || locked || totals.weight !== 100 || !supervisorId || !data?.cycleActive}>
                <Send className="mr-1.5 h-4 w-4" /> Review & submit
              </Button>
            </div>
          </div>
        </div>

        <AppraisalSummaryDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          submitting={saving}
          onConfirm={async () => {
            await saveAll(true);
            setConfirmOpen(false);
          }}
          profile={profile as { full_name?: string | null; designation?: string | null; department?: string | null; employee_no?: string | null } | null}
          period={period}
          supervisorName={(data?.supervisors ?? []).find((s) => s.id === supervisorId)?.full_name ?? null}
          targets={targets}
          self={selfReflection}
          signedAt={signedAt}
          totals={{ weight: totals.weight, pct: totals.pct }}
        />
      </main>
    </div>
  );
}

function PdfActions({ appraisalId }: { appraisalId: string | null }) {
  const gen = useServerFn(generateAppraisalPdf);
  const get = useServerFn(getAppraisalPdfUrl);
  const [busy, setBusy] = useState(false);
  if (!appraisalId) return null;
  async function open(regen: boolean) {
    if (!appraisalId) return;
    setBusy(true);
    try {
      const res = regen
        ? await gen({ data: { appraisalId } })
        : await get({ data: { appraisalId } });
      let url = res.url;
      if (!url) {
        const fresh = await gen({ data: { appraisalId } });
        url = fresh.url;
      }
      if (url) window.open(url, "_blank");
      else toast.error("Could not open PDF");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex gap-2">
      <Button size="sm" variant="outline" onClick={() => open(false)} disabled={busy}>
        <FileDown className="mr-1.5 h-3.5 w-3.5" /> Download PDF
      </Button>
      <Button size="sm" variant="ghost" onClick={() => open(true)} disabled={busy}>
        Regenerate
      </Button>
    </div>
  );
}

function SectionHeader({ number, title }: { number: string; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary font-display text-sm font-bold text-primary-foreground">{number}</div>
      <h2 className="font-display text-xl font-bold">{title}</h2>
    </div>
  );
}
function ReadOnly({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value || <span className="text-muted-foreground">—</span>}</div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1.5 block text-xs">{label}</Label>
      {children}
    </div>
  );
}

function canRoleSign(
  slot: "governor" | "cec" | "chief_officer" | "director",
  myRoles: AppRole[] | undefined,
  signoffs: CycleSignoffs,
): boolean {
  return !!myRoles?.includes(slot as AppRole);
}

function SignSlot({ label, slot, signoffs, onSign, disabled, fixedName, canSign, requiredRoleLabel }: {
  label: string;
  slot: keyof CycleSignoffs;
  signoffs: CycleSignoffs;
  onSign: (slot: keyof CycleSignoffs, name: string) => void;
  disabled?: boolean;
  fixedName?: string;
  canSign: boolean;
  requiredRoleLabel: string;
}) {
  const [name, setName] = useState(fixedName ?? "");
  const sig = signoffs[slot];

  useEffect(() => {
    if (!name && fixedName) setName(fixedName);
  }, [fixedName, name]);

  return (
    <div className="rounded-lg border border-dashed border-border p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      {sig?.signed_at ? (
        <div className="mt-1.5">
          <div className="font-display text-sm font-bold italic text-primary">{sig.name}</div>
          <div className="text-[10px] text-muted-foreground">Signed {new Date(sig.signed_at).toLocaleDateString()}</div>
        </div>
      ) : !canSign ? (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Lock className="h-3 w-3" /> Awaiting {requiredRoleLabel}
        </div>
      ) : (
        <div className="mt-1.5 space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">Awaiting Your Sign-Off</div>
          <Input className="h-8 text-xs" placeholder="Full name" value={name} disabled={disabled} onChange={(e) => setName(e.target.value)} />
          <Button size="sm" variant="outline" className="h-7 w-full text-xs" disabled={disabled} onClick={() => onSign(slot, name)}>
            <FileSignature className="mr-1 h-3 w-3" /> Sign Digitally
          </Button>
        </div>
      )}
    </div>
  );
}


function FinalReport({ appraisalId, signoffs }: { appraisalId: string | null; signoffs: CycleSignoffs }) {
  const gen = useServerFn(generateAppraisalReport);
  const get = useServerFn(getLatestAppraisalReport);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ narrative: string; createdAt: string } | null>(null);

  const required: Array<keyof CycleSignoffs> = ["appraisee", "supervisor", "director_endorsement"];
  const missing = required.filter((k) => !signoffs[k]?.signed_at);
  const ready = appraisalId && missing.length === 0;

  useEffect(() => {
    if (!appraisalId) return;
    get({ data: { appraisalId } }).then((r) => {
      if (r) setReport({ narrative: r.narrative, createdAt: r.created_at });
    }).catch(() => {});
  }, [appraisalId, get]);

  async function run() {
    if (!appraisalId) return;
    setBusy(true);
    try {
      const r = await gen({ data: { appraisalId } });
      setReport({ narrative: r.narrative, createdAt: r.createdAt });
      toast.success("AI report generated");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <Card className="mt-6 p-6">
      <SectionHeader number="9" title="Final appraisal report (AI)" />
      <p className="mt-2 text-sm text-muted-foreground">
        Generates a government-ready narrative report using Lovable AI (Gemini 3 Flash). Only available once the appraisee, supervisor and director endorsement chain is complete.
      </p>
      {!ready ? (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          <Lock className="h-4 w-4" /> Awaiting signatures: {missing.join(", ") || "—"}
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={run} disabled={busy}><Sparkles className="mr-1.5 h-4 w-4" />{busy ? "Generating…" : report ? "Regenerate report" : "Generate AI narrative report"}</Button>
        </div>
      )}
      {report && (
        <div className="mt-4 rounded-md border border-border bg-muted/20 p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Generated {new Date(report.createdAt).toLocaleString()}</div>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-relaxed">{report.narrative}</pre>
        </div>
      )}
    </Card>
  );
}

function SupervisorCard({
  sup, selected, disabled, onSelect,
}: {
  sup: { id: string; full_name: string; designation: string | null; department: string | null; directorate: string | null; photo_url: string | null };
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const initials = (sup.full_name || "?").split(/\s+/).filter(Boolean).slice(0, 3).map((p) => p[0]?.toUpperCase()).join("");
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={`group flex w-full flex-col items-start gap-3 rounded-lg border p-4 text-left transition ${
        selected ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "border-border bg-card hover:border-primary/50 hover:bg-muted/30"
      } ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
    >
      <div className="flex w-full items-center gap-3">
        {sup.photo_url ? (
          <img src={sup.photo_url} alt={sup.full_name} className="h-14 w-14 shrink-0 rounded-full border border-border object-cover" />
        ) : (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/30 to-primary/10 text-base font-bold text-primary" aria-hidden>
            {initials || "👤"}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold leading-tight">{sup.full_name}</div>
          <div className="truncate text-xs text-muted-foreground">{sup.designation || "Supervisor"}</div>
        </div>
        {selected && <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase text-primary-foreground">Selected</span>}
      </div>
      <div className="grid w-full grid-cols-2 gap-2 border-t border-border/50 pt-2 text-[11px]">
        <div>
          <div className="text-muted-foreground">Department</div>
          <div className="truncate font-medium">{sup.department || "—"}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Directorate</div>
          <div className="truncate font-medium">{sup.directorate || "—"}</div>
        </div>
      </div>
    </button>
  );
}
