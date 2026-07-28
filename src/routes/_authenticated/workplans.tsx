import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Trash2, ClipboardList, ArrowRight, Upload, FileText, Download, Send, CheckCircle, XCircle, RotateCcw } from "lucide-react";
import { useRoles, hasAnyRole, type AppRole } from "@/hooks/useRoles";

export const Route = createFileRoute("/_authenticated/workplans")({
  head: () => ({ meta: [{ title: "Workplans — Bungoma CPMS" }] }),
  component: WorkplansPage,
});

const period = `FY ${new Date().getFullYear()}/${(new Date().getFullYear() + 1).toString().slice(-2)}`;

async function openWorkplanDoc(path: string) {
  const { data, error } = await supabase.storage.from("workplan-documents").createSignedUrl(path, 60 * 10);
  if (error || !data?.signedUrl) { toast.error(error?.message ?? "Could not open document"); return; }
  window.open(data.signedUrl, "_blank");
}

function DocLink({ wp }: { wp: { document_path?: string | null; document_name?: string | null } }) {
  if (!wp.document_path) return null;
  return (
    <button onClick={() => openWorkplanDoc(wp.document_path!)} className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10">
      <FileText className="h-3 w-3" /> {wp.document_name ?? "Workplan document"} <Download className="h-3 w-3" />
    </button>
  );
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    submitted: "bg-amber-100 text-amber-800 border-amber-300",
    approved: "bg-emerald-100 text-emerald-800 border-emerald-300",
    returned: "bg-red-100 text-red-800 border-red-300",
  };
  return map[status] ?? "bg-muted text-muted-foreground";
}

type AssigneeOption = { id: string; full_name: string; designation: string | null; department: string | null };

function eligibleTargetRoles(myRoles: AppRole[] | undefined): AppRole[] {
  if (!myRoles) return [];
  const out = new Set<AppRole>();
  if (myRoles.includes("supervisor") || myRoles.includes("director")) out.add("employee");
  if (myRoles.includes("director")) out.add("supervisor");
  if (myRoles.includes("chief_officer")) out.add("director");
  if (myRoles.includes("cec")) out.add("chief_officer");
  if (myRoles.includes("governor")) out.add("cec");
  return Array.from(out);
}

function WorkplansPage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const { data: myRoles } = useRoles(user.id);
  const canAssign = (myRoles ?? []).some((r) =>
    (["supervisor", "director", "chief_officer", "cec", "governor"] as AppRole[]).includes(r),
  );
  const isSupervisorOrAbove = hasAnyRole(myRoles, ["supervisor", "director", "chief_officer", "cec", "governor"]);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader authenticated userId={user.id} />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-primary">Workplan management</div>
          <h1 className="mt-2 font-display text-3xl font-bold">Workplans</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your own workplan and submit it to your supervisor for approval. Approved workplans become the basis for appraisal.
          </p>
        </div>

        <Tabs defaultValue="my-workplans" className="mt-6">
          <TabsList>
            <TabsTrigger value="my-workplans">My Workplans</TabsTrigger>
            <TabsTrigger value="create-own">Create Workplan</TabsTrigger>
            {isSupervisorOrAbove && <TabsTrigger value="pending-review">Pending Review</TabsTrigger>}
            {canAssign && <TabsTrigger value="i-assigned">Assigned by me</TabsTrigger>}
            {canAssign && <TabsTrigger value="cascade">Cascade to staff</TabsTrigger>}
          </TabsList>

          <TabsContent value="my-workplans"><MyWorkplans userId={user.id} qc={qc} /></TabsContent>
          <TabsContent value="create-own"><CreateOwnWorkplan userId={user.id} qc={qc} /></TabsContent>
          {isSupervisorOrAbove && <TabsContent value="pending-review"><PendingReview userId={user.id} qc={qc} /></TabsContent>}
          {canAssign && <TabsContent value="i-assigned"><IAssigned userId={user.id} qc={qc} /></TabsContent>}
          {canAssign && <TabsContent value="cascade"><AssignNew userId={user.id} myRoles={myRoles} qc={qc} /></TabsContent>}
        </Tabs>
      </main>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Tab: My Workplans (all workplans where assignee_id = me)
// ────────────────────────────────────────────────────────────
function MyWorkplans({ userId, qc }: { userId: string; qc: ReturnType<typeof useQueryClient> }) {
  const { data: rows } = useQuery({
    queryKey: ["my-workplans", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("workplans")
        .select("*, profiles:assigned_by(full_name, designation)")
        .eq("assignee_id", userId)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  async function pullIntoAppraisal(wp: { id: string; period: string; strategic_objective: string; activity: string; kpi: string; target_value: string; weight: number | null; expected_deliverable: string | null }) {
    try {
      let { data: app } = await supabase.from("appraisals").select("id, status").eq("employee_id", userId).eq("period", wp.period).maybeSingle();
      if (!app) {
        const { data: created, error } = await supabase.from("appraisals").insert({ employee_id: userId, period: wp.period, status: "draft" }).select().single();
        if (error) throw error;
        app = created;
      }
      const { count } = await supabase.from("targets").select("id", { count: "exact", head: true }).eq("appraisal_id", app!.id);
      const { error: tErr } = await supabase.from("targets").insert({
        appraisal_id: app!.id,
        target: `${wp.strategic_objective} — ${wp.activity}`,
        indicator: wp.kpi,
        weight: wp.weight ?? 0,
        expected_outcome: wp.expected_deliverable ?? wp.target_value,
        achieved_result: "",
        score: 0,
        sort_order: count ?? 0,
      });
      if (tErr) throw tErr;
      await supabase.from("workplans").update({ pulled_into_appraisal_at: new Date().toISOString() }).eq("id", wp.id);
      toast.success("Added to My Appraisal as a target");
      qc.invalidateQueries({ queryKey: ["my-workplans", userId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to import");
    }
  }

  async function submitWorkplan(id: string, note: string) {
    const { error } = await supabase.from("workplans").update({ status: "submitted", submission_note: note || null }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Workplan submitted for review");
    qc.invalidateQueries({ queryKey: ["my-workplans", userId] });
  }

  async function deleteWorkplan(id: string) {
    if (!confirm("Delete this workplan?")) return;
    const { error } = await supabase.from("workplans").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    qc.invalidateQueries({ queryKey: ["my-workplans", userId] });
  }

  if (!rows || rows.length === 0) {
    return <Card className="mt-4 p-8 text-center text-sm text-muted-foreground">
      <ClipboardList className="mx-auto h-8 w-8 opacity-40" />
      <p className="mt-2">No workplans yet. Use the "Create Workplan" tab to create your own, or they will appear here once assigned by your supervisor.</p>
    </Card>;
  }
  return (
    <div className="mt-4 space-y-3">
      {rows.map((w) => {
        const assigner = w.profiles as { full_name?: string; designation?: string } | null;
        const isSelf = w.assigned_by === userId || !w.assigned_by;
        const isDraft = w.status === "draft" || !w.status;
        const isReturned = w.status === "returned";
        const isApproved = w.status === "approved" || Boolean(w.approved_at);
        return (
          <WorkplanCard key={w.id}
            w={w} assigner={assigner} isSelf={isSelf}
            isDraft={isDraft} isReturned={isReturned} isApproved={isApproved}
            onSubmit={submitWorkplan}
            onDelete={deleteWorkplan}
            onPull={pullIntoAppraisal}
          />
        );
      })}
    </div>
  );
}

function WorkplanCard({ w, assigner, isSelf, isDraft, isReturned, isApproved, onSubmit, onDelete, onPull }: {
  w: Record<string, unknown>;
  assigner: { full_name?: string; designation?: string } | null;
  isSelf: boolean; isDraft: boolean; isReturned: boolean; isApproved: boolean;
  onSubmit: (id: string, note: string) => void;
  onDelete: (id: string) => void;
  onPull: (wp: { id: string; period: string; strategic_objective: string; activity: string; kpi: string; target_value: string; weight: number | null; expected_deliverable: string | null }) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [note, setNote] = useState("");
  const canSubmit = isSelf && (isDraft || isReturned);
  const canPull = isApproved && !w.pulled_into_appraisal_at;
  const status = (w.status as string) || "draft";

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-primary">{String(w.period)} · {String(w.strategic_objective)}</div>
          <div className="mt-1 font-display text-lg font-bold">{String(w.activity)}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {isSelf ? "Self-created" : `Assigned by ${assigner?.full_name ?? "—"}${assigner?.designation ? ` · ${assigner.designation}` : ""}`}
          </div>
          {isReturned && !!w.reviewer_comment && (
            <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <span className="font-semibold">Returned:</span> {String(w.reviewer_comment)}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold capitalize ${statusBadge(status)}`}>{status}</span>
          <span className="rounded-full border bg-muted px-2.5 py-0.5 text-[11px] font-semibold uppercase">{String(w.weight ?? 0)}%</span>
          {canPull && (
            <Button size="sm" onClick={() => onPull(w as never)}><ArrowRight className="mr-1 h-3 w-3" /> Add to My Appraisal</Button>
          )}
          {!!w.pulled_into_appraisal_at && (
            <span className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-[11px] text-primary">In My Appraisal</span>
          )}
        </div>
      </div>
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div><span className="text-xs text-muted-foreground">KPI</span><div>{String(w.kpi)}</div></div>
        <div><span className="text-xs text-muted-foreground">Target</span><div>{String(w.target_value)}</div></div>
        {!!w.timeline && <div><span className="text-xs text-muted-foreground">Timeline</span><div>{String(w.timeline)}</div></div>}
        {!!w.expected_deliverable && <div><span className="text-xs text-muted-foreground">Expected deliverable</span><div>{String(w.expected_deliverable)}</div></div>}
      </div>
      <DocLink wp={w as never} />
      {canSubmit && (
        <div className="mt-3 border-t pt-3">
          {submitting ? (
            <div className="space-y-2">
              <Textarea rows={2} placeholder="Optional submission note to your supervisor…" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => { onSubmit(String(w.id), note); setSubmitting(false); }}>
                  <Send className="h-3.5 w-3.5 mr-1" /> Submit for review
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSubmitting(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setSubmitting(true)}>
                <Send className="h-3.5 w-3.5 mr-1" /> Submit to supervisor
              </Button>
              {isDraft && (
                <Button size="sm" variant="ghost" onClick={() => onDelete(String(w.id))}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ────────────────────────────────────────────────────────────
// Tab: Create own workplan (appraisee self-creates)
// ────────────────────────────────────────────────────────────
function CreateOwnWorkplan({ userId, qc }: { userId: string; qc: ReturnType<typeof useQueryClient> }) {
  const [strategicObjective, setStrategicObjective] = useState("");
  const [activity, setActivity] = useState("");
  const [kpi, setKpi] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [timeline, setTimeline] = useState("");
  const [weight, setWeight] = useState(0);
  const [deliverable, setDeliverable] = useState("");
  const [resources, setResources] = useState("");
  const [workplanType, setWorkplanType] = useState<"annual" | "quarterly">("annual");
  const [quarter, setQuarter] = useState<number>(1);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!strategicObjective || !activity || !kpi || !targetValue) return toast.error("Fill all required fields");
    setBusy(true);
    try {
      const reportingPeriod = workplanType === "quarterly" ? `${period} · Q${quarter}` : period;
      const { error } = await supabase.from("workplans").insert({
        assignee_id: userId,
        assigned_by: userId,        // self-created
        period,
        strategic_objective: strategicObjective,
        activity, kpi, target_value: targetValue,
        timeline: timeline || null,
        weight, expected_deliverable: deliverable || null,
        resources_required: resources || null,
        workplan_type: workplanType,
        quarter: workplanType === "quarterly" ? quarter : null,
        reporting_period: reportingPeriod,
        status: "draft",
      });
      if (error) throw error;
      toast.success("Workplan saved as draft. Submit it from 'My Workplans' when ready.");
      setStrategicObjective(""); setActivity(""); setKpi(""); setTargetValue(""); setTimeline("");
      setWeight(0); setDeliverable(""); setResources("");
      qc.invalidateQueries({ queryKey: ["my-workplans", userId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }

  return (
    <Card className="mt-4 p-6">
      <p className="text-sm text-muted-foreground mb-4">
        Create your own workplan based on your departmental objectives. Once complete, submit it to your supervisor from the <strong>My Workplans</strong> tab for review and approval.
      </p>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label className="mb-1.5 block text-xs">Workplan type</Label>
            <Select value={workplanType} onValueChange={(v) => setWorkplanType(v as "annual" | "quarterly")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="annual">Annual</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {workplanType === "quarterly" && (
            <div>
              <Label className="mb-1.5 block text-xs">Quarter</Label>
              <Select value={String(quarter)} onValueChange={(v) => setQuarter(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4].map((q) => <SelectItem key={q} value={String(q)}>Q{q}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label className="mb-1.5 block text-xs">Reporting period</Label>
            <Input value={period} disabled />
          </div>
        </div>
        <div>
          <Label className="mb-1.5 block text-xs">Performance objective <span className="text-destructive">*</span></Label>
          <Input value={strategicObjective} onChange={(e) => setStrategicObjective(e.target.value)} required />
        </div>
        <div>
          <Label className="mb-1.5 block text-xs">Key activities <span className="text-destructive">*</span></Label>
          <Textarea rows={2} value={activity} onChange={(e) => setActivity(e.target.value)} required />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5 block text-xs">Performance indicator (numeric) <span className="text-destructive">*</span></Label>
            <Input type="number" value={kpi} onChange={(e) => setKpi(e.target.value)} placeholder="e.g. 100" required />
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">Individual target <span className="text-destructive">*</span></Label>
            <Input value={targetValue} onChange={(e) => setTargetValue(e.target.value)} required />
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">Time frame</Label>
            <Input value={timeline} onChange={(e) => setTimeline(e.target.value)} placeholder="e.g. Q1 — Q2" />
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">Weight (%)</Label>
            <Input type="number" min={0} max={100} value={weight} onChange={(e) => setWeight(Number(e.target.value))} />
          </div>
        </div>
        <div>
          <Label className="mb-1.5 block text-xs">Resources required</Label>
          <Textarea rows={2} value={resources} onChange={(e) => setResources(e.target.value)} />
        </div>
        <div>
          <Label className="mb-1.5 block text-xs">Expected deliverable</Label>
          <Textarea rows={2} value={deliverable} onChange={(e) => setDeliverable(e.target.value)} />
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={busy}><Plus className="mr-1.5 h-4 w-4" />{busy ? "Saving…" : "Save as draft"}</Button>
        </div>
      </form>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────
// Tab: Pending Review (supervisor sees submitted workplans)
// ────────────────────────────────────────────────────────────
function PendingReview({ userId, qc }: { userId: string; qc: ReturnType<typeof useQueryClient> }) {
  const [comment, setComment] = useState<Record<string, string>>({});

  // Load workplans submitted by employees who report to this supervisor
  const { data: rows } = useQuery({
    queryKey: ["pending-review-workplans", userId],
    queryFn: async () => {
      // Get direct reports
      const { data: reports } = await supabase.rpc("hierarchy_reports", { _actor: userId });
      const reportIds = ((reports as { reports?: { user_id: string }[] } | null)?.reports ?? []).map((r) => r.user_id);
      if (reportIds.length === 0) return [];
      const { data } = await supabase
        .from("workplans")
        .select("*, profiles:assignee_id(full_name, designation, department)")
        .in("assignee_id", reportIds)
        .eq("status", "submitted")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  async function approve(id: string) {
    const { data: wp } = await supabase.from("workplans").select("*").eq("id", id).maybeSingle();
    if (!wp) return;
    await supabase.from("workplan_versions").insert({
      workplan_id: id, version: (wp.version as number) ?? 1,
      snapshot: JSON.parse(JSON.stringify(wp)), changed_by: userId, change_reason: "Approved",
    });
    const { error } = await supabase.from("workplans")
      .update({ status: "approved", approved_at: new Date().toISOString(), approved_by: userId, reviewer_comment: null })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Workplan approved and locked");
    qc.invalidateQueries({ queryKey: ["pending-review-workplans", userId] });
    qc.invalidateQueries({ queryKey: ["my-workplans"] });
  }

  async function returnForCorrection(id: string) {
    const c = comment[id]?.trim();
    if (!c) { toast.error("You must provide a comment explaining what needs to be corrected."); return; }
    const { error } = await supabase.from("workplans")
      .update({ status: "returned", reviewer_comment: c })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Workplan returned for correction");
    setComment((prev) => { const n = { ...prev }; delete n[id]; return n; });
    qc.invalidateQueries({ queryKey: ["pending-review-workplans", userId] });
    qc.invalidateQueries({ queryKey: ["my-workplans"] });
  }

  if (!rows || rows.length === 0) {
    return <Card className="mt-4 p-8 text-center text-sm text-muted-foreground">
      <CheckCircle className="mx-auto h-8 w-8 opacity-40" />
      <p className="mt-2">No workplans pending review. Employees must submit their workplans for them to appear here.</p>
    </Card>;
  }

  return (
    <div className="mt-4 space-y-4">
      {rows.map((w) => {
        const emp = w.profiles as { full_name?: string; designation?: string; department?: string } | null;
        return (
          <Card key={w.id} className="p-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex flex-wrap gap-2 items-center text-xs font-semibold uppercase tracking-wider text-primary">
                  <span>{String(w.period)} · {String(w.strategic_objective)}</span>
                  <Badge variant="secondary">Submitted</Badge>
                </div>
                <div className="font-display text-lg font-bold">{String(w.activity)}</div>
                <div className="text-xs text-muted-foreground">{emp?.full_name ?? "—"}{emp?.designation ? ` · ${emp.designation}` : ""}{emp?.department ? ` · ${emp.department}` : ""}</div>
              </div>
            </div>
            <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
              <div><span className="text-xs text-muted-foreground">KPI</span><div>{String(w.kpi)}</div></div>
              <div><span className="text-xs text-muted-foreground">Target</span><div>{String(w.target_value)}</div></div>
              <div><span className="text-xs text-muted-foreground">Weight</span><div>{String(w.weight ?? 0)}%</div></div>
            </div>
            {w.submission_note && (
              <div className="mt-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
                <span className="font-semibold">Note from employee:</span> {String(w.submission_note)}
              </div>
            )}
            <DocLink wp={w as never} />
            <div className="mt-4 border-t pt-3 space-y-2">
              <Textarea
                rows={2}
                placeholder="Comment (required when returning for correction)"
                value={comment[w.id] ?? ""}
                onChange={(e) => setComment((prev) => ({ ...prev, [w.id]: e.target.value }))}
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => approve(w.id)}>
                  <CheckCircle className="h-3.5 w-3.5 mr-1" /> Approve &amp; lock
                </Button>
                <Button size="sm" variant="outline" onClick={() => returnForCorrection(w.id)}>
                  <RotateCcw className="h-3.5 w-3.5 mr-1" /> Return for correction
                </Button>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Tab: I Assigned (supervisor-assigned workplans)
// ────────────────────────────────────────────────────────────
function IAssigned({ userId, qc }: { userId: string; qc: ReturnType<typeof useQueryClient> }) {
  const { data: rows } = useQuery({
    queryKey: ["wp-i-assigned", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("workplans")
        .select("*, profiles:assignee_id(full_name, designation, department)")
        .eq("assigned_by", userId)
        .neq("assignee_id", userId) // exclude self-created
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  async function remove(id: string) {
    if (!confirm("Delete this workplan?")) return;
    const { error } = await supabase.from("workplans").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    qc.invalidateQueries({ queryKey: ["wp-i-assigned", userId] });
  }

  if (!rows || rows.length === 0) {
    return <Card className="mt-4 p-8 text-center text-sm text-muted-foreground">You haven't cascaded any workplans yet.</Card>;
  }
  return (
    <div className="mt-4 space-y-3">
      {rows.map((w) => {
        const assignee = w.profiles as { full_name?: string; designation?: string; department?: string } | null;
        const approved = Boolean(w.approved_at);
        return (
          <Card key={w.id} className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
                  <span>{String(w.period)} · {String(w.strategic_objective)}</span>
                  <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px]">
                    {w.workplan_type === "quarterly" ? `Q${w.quarter ?? "?"}` : "Annual"} · v{String(w.version ?? 1)}
                  </span>
                </div>
                <div className="font-display text-lg font-bold">{String(w.activity)}</div>
                <div className="text-xs text-muted-foreground">To {assignee?.full_name ?? "—"}{assignee?.designation ? ` · ${assignee.designation}` : ""}{assignee?.department ? ` · ${assignee.department}` : ""}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold capitalize ${statusBadge(String(w.status ?? "draft"))}`}>{String(w.status ?? "draft")}</span>
                {!approved && <Button variant="ghost" size="sm" onClick={() => remove(w.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
              </div>
            </div>
            <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
              <div><span className="text-xs text-muted-foreground">KPI</span><div>{String(w.kpi)}</div></div>
              <div><span className="text-xs text-muted-foreground">Target</span><div>{String(w.target_value)}</div></div>
              <div><span className="text-xs text-muted-foreground">Weight</span><div>{String(w.weight ?? 0)}%</div></div>
            </div>
            <DocLink wp={w as never} />
          </Card>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Tab: Cascade new workplan to staff (supervisor → employee)
// ────────────────────────────────────────────────────────────
function AssignNew({ userId, myRoles, qc }: { userId: string; myRoles: AppRole[] | undefined; qc: ReturnType<typeof useQueryClient> }) {
  const targetRoles = useMemo(() => eligibleTargetRoles(myRoles), [myRoles]);
  const [targetRole, setTargetRole] = useState<AppRole | "">("");
  const [assigneeId, setAssigneeId] = useState("");
  const [strategicObjective, setStrategicObjective] = useState("");
  const [activity, setActivity] = useState("");
  const [kpi, setKpi] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [timeline, setTimeline] = useState("");
  const [weight, setWeight] = useState(0);
  const [deliverable, setDeliverable] = useState("");
  const [resources, setResources] = useState("");
  const [workplanType, setWorkplanType] = useState<"annual" | "quarterly">("annual");
  const [quarter, setQuarter] = useState<number>(1);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"build" | "upload">("build");
  const [file, setFile] = useState<File | null>(null);

  const { data: options } = useQuery({
    queryKey: ["wp-assignees", targetRole],
    enabled: !!targetRole,
    queryFn: async () => {
      const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", targetRole as AppRole);
      const ids = (roles ?? []).map((r) => r.user_id as string);
      if (ids.length === 0) return [] as AssigneeOption[];
      const { data: profs } = await supabase.from("profiles").select("id, full_name, designation, department").in("id", ids);
      return ((profs ?? []) as AssigneeOption[]).sort((a, b) => (a.full_name || "").localeCompare(b.full_name || ""));
    },
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!assigneeId || !strategicObjective || !activity || !kpi || !targetValue) return toast.error("Fill all required fields");
    setBusy(true);
    try {
      const reportingPeriod = workplanType === "quarterly" ? `${period} · Q${quarter}` : period;
      const { error } = await supabase.from("workplans").insert({
        assignee_id: assigneeId, assigned_by: userId, period,
        strategic_objective: strategicObjective,
        activity, kpi, target_value: targetValue,
        timeline: timeline || null, weight,
        expected_deliverable: deliverable || null,
        resources_required: resources || null,
        workplan_type: workplanType,
        quarter: workplanType === "quarterly" ? quarter : null,
        reporting_period: reportingPeriod,
        status: "approved", approved_at: new Date().toISOString(), approved_by: userId,
      });
      if (error) throw error;
      toast.success("Workplan cascaded to staff member");
      setStrategicObjective(""); setActivity(""); setKpi(""); setTargetValue("");
      setTimeline(""); setWeight(0); setDeliverable(""); setResources("");
      qc.invalidateQueries({ queryKey: ["wp-i-assigned", userId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }

  const ALLOWED = ["application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];

  async function uploadSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!assigneeId) return toast.error("Pick an assignee first");
    if (!file) return toast.error("Choose a file (PDF, Word, or Excel)");
    if (!ALLOWED.includes(file.type) && !/\.(pdf|docx?|xlsx?)$/i.test(file.name)) return toast.error("Unsupported file type");
    if (file.size > 20 * 1024 * 1024) return toast.error("File exceeds 20 MB");
    setBusy(true);
    try {
      const path = `${assigneeId}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("workplan-documents").upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const { error } = await supabase.from("workplans").insert({
        assignee_id: assigneeId, assigned_by: userId, period,
        strategic_objective: strategicObjective || "Uploaded Workplan",
        activity: file.name, kpi: "See attached document",
        target_value: "Per attached workplan", weight: 0,
        expected_deliverable: "Refer to attached workplan document",
        document_path: path, document_name: file.name,
        document_type: file.type, document_size: file.size,
        status: "approved", approved_at: new Date().toISOString(), approved_by: userId,
      });
      if (error) throw error;
      toast.success("Workplan uploaded & assigned");
      setFile(null);
      qc.invalidateQueries({ queryKey: ["wp-i-assigned", userId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally { setBusy(false); }
  }

  if (targetRoles.length === 0) {
    return <Card className="mt-4 p-8 text-center text-sm text-muted-foreground">Your role doesn't have downstream staff configured.</Card>;
  }

  return (
    <Card className="mt-4 p-6">
      <p className="text-sm text-muted-foreground mb-4">Cascade a workplan directly to a staff member. Cascaded workplans are immediately approved.</p>
      <div className="flex gap-2 mb-4">
        <Button size="sm" variant={mode === "build" ? "default" : "outline"} onClick={() => setMode("build")}><Plus className="mr-1 h-3 w-3" /> Build in-system</Button>
        <Button size="sm" variant={mode === "upload" ? "default" : "outline"} onClick={() => setMode("upload")}><Upload className="mr-1 h-3 w-3" /> Upload document</Button>
      </div>
      <AssigneePickers targetRole={targetRole} setTargetRole={setTargetRole} assigneeId={assigneeId} setAssigneeId={setAssigneeId} targetRoles={targetRoles} options={options ?? []} />
      {mode === "build" ? (
        <form onSubmit={submit} className="space-y-4 mt-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label className="mb-1.5 block text-xs">Type</Label>
              <Select value={workplanType} onValueChange={(v) => setWorkplanType(v as "annual" | "quarterly")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="annual">Annual</SelectItem><SelectItem value="quarterly">Quarterly</SelectItem></SelectContent>
              </Select>
            </div>
            {workplanType === "quarterly" && (
              <div>
                <Label className="mb-1.5 block text-xs">Quarter</Label>
                <Select value={String(quarter)} onValueChange={(v) => setQuarter(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{[1,2,3,4].map(q => <SelectItem key={q} value={String(q)}>Q{q}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div><Label className="mb-1.5 block text-xs">Period</Label><Input value={period} disabled /></div>
          </div>
          <div><Label className="mb-1.5 block text-xs">Performance objective *</Label><Input value={strategicObjective} onChange={(e) => setStrategicObjective(e.target.value)} required /></div>
          <div><Label className="mb-1.5 block text-xs">Key activities *</Label><Textarea rows={2} value={activity} onChange={(e) => setActivity(e.target.value)} required /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label className="mb-1.5 block text-xs">Performance indicator (numeric) *</Label><Input type="number" value={kpi} onChange={(e) => setKpi(e.target.value)} required /></div>
            <div><Label className="mb-1.5 block text-xs">Individual target *</Label><Input value={targetValue} onChange={(e) => setTargetValue(e.target.value)} required /></div>
            <div><Label className="mb-1.5 block text-xs">Time frame</Label><Input value={timeline} onChange={(e) => setTimeline(e.target.value)} /></div>
            <div><Label className="mb-1.5 block text-xs">Weight (%)</Label><Input type="number" min={0} max={100} value={weight} onChange={(e) => setWeight(Number(e.target.value))} /></div>
          </div>
          <div><Label className="mb-1.5 block text-xs">Resources</Label><Textarea rows={2} value={resources} onChange={(e) => setResources(e.target.value)} /></div>
          <div><Label className="mb-1.5 block text-xs">Expected deliverable</Label><Textarea rows={2} value={deliverable} onChange={(e) => setDeliverable(e.target.value)} /></div>
          <div className="flex justify-end"><Button type="submit" disabled={busy}>{busy ? "Assigning…" : "Cascade workplan"}</Button></div>
        </form>
      ) : (
        <form onSubmit={uploadSubmit} className="space-y-4 mt-4">
          <div><Label className="mb-1.5 block text-xs">Title</Label><Input value={strategicObjective} onChange={(e) => setStrategicObjective(e.target.value)} placeholder="e.g. Annual Workplan FY 2025/26" /></div>
          <div>
            <Label className="mb-1.5 block text-xs">File (PDF, Word, Excel · max 20 MB)</Label>
            <Input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {file && <p className="mt-1 text-xs text-muted-foreground">{file.name} · {(file.size / 1024).toFixed(0)} KB</p>}
          </div>
          <div className="flex justify-end"><Button type="submit" disabled={busy}><Upload className="mr-1.5 h-4 w-4" />{busy ? "Uploading…" : "Upload & assign"}</Button></div>
        </form>
      )}
    </Card>
  );
}

function AssigneePickers({ targetRole, setTargetRole, assigneeId, setAssigneeId, targetRoles, options }: {
  targetRole: AppRole | ""; setTargetRole: (v: AppRole | "") => void;
  assigneeId: string; setAssigneeId: (v: string) => void;
  targetRoles: AppRole[]; options: AssigneeOption[];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <Label className="mb-1.5 block text-xs">Assign to (role)</Label>
        <Select value={targetRole} onValueChange={(v) => { setTargetRole(v as AppRole); setAssigneeId(""); }}>
          <SelectTrigger><SelectValue placeholder="Choose role…" /></SelectTrigger>
          <SelectContent>{targetRoles.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div>
        <Label className="mb-1.5 block text-xs">Assignee</Label>
        <Select value={assigneeId} onValueChange={setAssigneeId} disabled={!targetRole}>
          <SelectTrigger><SelectValue placeholder={targetRole ? "Choose person…" : "Select role first"} /></SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.id} value={o.id}>{o.full_name}{o.designation ? ` — ${o.designation}` : ""}{o.department ? ` · ${o.department}` : ""}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
