import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Upload, MessageCircle, Paperclip, History } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { createContinuousReview, updateContinuousReview } from "@/lib/appraisal.functions";

export const Route = createFileRoute("/_authenticated/continuous-review")({
  head: () => ({ meta: [{ title: "Continuous Review — Bungoma CPMS" }] }),
  component: ContinuousReviewPage,
});

const STATUS_OPTIONS = [
  { value: "not_started", label: "Not Started" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "delayed", label: "Delayed" },
  { value: "on_hold", label: "On Hold" },
];

function statusLabel(v: string) { return STATUS_OPTIONS.find((s) => s.value === v)?.label ?? v; }
function statusColor(v: string) {
  switch (v) {
    case "completed": return "border-emerald-400/50 bg-emerald-500/10 text-emerald-700";
    case "in_progress": return "border-primary/40 bg-primary/10 text-primary";
    case "delayed": return "border-orange-400/50 bg-orange-500/10 text-orange-700";
    case "on_hold": return "border-amber-400/50 bg-amber-500/10 text-amber-700";
    default: return "border-border bg-muted text-muted-foreground";
  }
}

function ContinuousReviewPage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();

  const { data: myAppraisals } = useQuery({
    queryKey: ["cr-appraisals", user.id],
    queryFn: async () => {
      const { data } = await supabase.from("appraisals")
        .select("id, period, status, employee_id, chosen_supervisor_id, profiles:employee_id(full_name)")
        .or(`employee_id.eq.${user.id},chosen_supervisor_id.eq.${user.id}`)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const [appraisalId, setAppraisalId] = useState<string>("");
  useEffect(() => { if (myAppraisals?.length && !appraisalId) setAppraisalId(myAppraisals[0].id); }, [myAppraisals, appraisalId]);

  const selected = myAppraisals?.find((a) => a.id === appraisalId);
  const isOwner = selected?.employee_id === user.id;
  const isSupervisor = selected?.chosen_supervisor_id === user.id;

  const { data: reviews } = useQuery({
    queryKey: ["cr-list", appraisalId],
    enabled: !!appraisalId,
    queryFn: async () => {
      const { data } = await supabase.from("continuous_reviews")
        .select("*")
        .eq("appraisal_id", appraisalId)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const [openNew, setOpenNew] = useState(false);
  const [achievement, setAchievement] = useState("");
  const [status, setStatus] = useState("in_progress");
  const [comment, setComment] = useState("");
  const [challenges, setChallenges] = useState("");
  const [mitigation, setMitigation] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const createCrFn = useServerFn(createContinuousReview);
  const updateCrFn = useServerFn(updateContinuousReview);

  async function submitNew() {
    if (!appraisalId || !achievement.trim()) return toast.error("Enter an achievement");
    setBusy(true);
    try {
      let evidence_path: string | null = null;
      let evidence_filename: string | null = null;
      let evidence_mime: string | null = null;
      if (file) {
        if (file.size > 10 * 1024 * 1024) {
          toast.error("Evidence must be 10MB or smaller");
          setBusy(false); return;
        }
        const allowed = [
          "application/pdf",
          "application/msword",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/vnd.ms-excel",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/zip",
          "image/jpeg", "image/png", "image/webp",
        ];
        if (file.type && !allowed.includes(file.type)) {
          toast.error("Allowed types: PDF, Word, Excel, image, or ZIP");
          setBusy(false); return;
        }
        const key = `${user.id}/${appraisalId}/${Date.now()}-${file.name}`;
        const { error: upErr } = await supabase.storage.from("continuous-review-evidence").upload(key, file);
        if (upErr) throw upErr;
        evidence_path = key;
        evidence_filename = file.name;
        evidence_mime = file.type;
      }
      await createCrFn({ data: {
        appraisalId: appraisalId,
        achievement: achievement.trim(),
        progressStatus: status,
        progressComment: comment || null,
        challenges: challenges || null,
        mitigation: mitigation || null,
        evidencePath: evidence_path,
        evidenceFilename: evidence_filename,
        evidenceMime: evidence_mime,
      } });
      toast.success("Progress update recorded");
      setOpenNew(false);
      setAchievement(""); setComment(""); setChallenges(""); setMitigation(""); setFile(null); setStatus("in_progress");
      qc.invalidateQueries({ queryKey: ["cr-list", appraisalId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }

  async function downloadEvidence(path: string, filename: string) {
    const { data, error } = await supabase.storage.from("continuous-review-evidence").createSignedUrl(path, 600);
    if (error) return toast.error(error.message);
    const a = document.createElement("a"); a.href = data.signedUrl; a.download = filename; a.target = "_blank"; a.click();
  }

  async function addSupervisorComment(id: string, current: string) {
    const text = prompt("Supervisor comment", current ?? "");
    if (text === null) return;
    try {
      await updateCrFn({ data: { id, supervisorComment: text || null } });
    } catch (e) {
      return toast.error(e instanceof Error ? e.message : "Failed to save");
    }
    toast.success("Comment saved");
    qc.invalidateQueries({ queryKey: ["cr-list", appraisalId] });
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader authenticated userId={user.id} />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-primary">Continuous performance review</div>
          <h1 className="mt-2 font-display text-3xl font-bold">Progress, evidence & feedback</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Capture achievements, attach supporting evidence, log challenges, and receive ongoing supervisor feedback throughout the cycle.
          </p>
        </div>

        <Card className="mt-6 p-4">
          <Label className="text-xs">Choose appraisal cycle</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {(myAppraisals ?? []).map((a) => (
              <button key={a.id} onClick={() => setAppraisalId(a.id)}
                className={`rounded-md border px-3 py-1.5 text-xs ${a.id === appraisalId ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>
                {a.period} · {a.employee_id === user.id ? "You" : (a.profiles as { full_name?: string } | null)?.full_name ?? "Employee"}
              </button>
            ))}
            {(!myAppraisals || myAppraisals.length === 0) && (
              <p className="text-sm text-muted-foreground">No appraisals yet. Create one from My Appraisal to start logging progress.</p>
            )}
          </div>
        </Card>

        {appraisalId && isOwner && (
          <div className="mt-6 flex justify-end">
            <Button onClick={() => setOpenNew((v) => !v)}><Plus className="mr-1.5 h-4 w-4" /> Log progress update</Button>
          </div>
        )}

        {openNew && isOwner && (
          <Card className="mt-3 p-6">
            <h2 className="font-display text-lg font-bold">New progress update</h2>
            <div className="mt-4 grid gap-4">
              <div>
                <Label className="mb-1.5 block text-xs">Achievement / milestone</Label>
                <Textarea rows={2} value={achievement} onChange={(e) => setAchievement(e.target.value)} placeholder="What was accomplished?" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label className="mb-1.5 block text-xs">Status</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{STATUS_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs">Evidence file — PDF, Word, Excel, image, or ZIP · max 10MB</Label>
                  <Input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.zip,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </div>
              </div>
              <div>
                <Label className="mb-1.5 block text-xs">Progress comments</Label>
                <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label className="mb-1.5 block text-xs">Challenges</Label>
                  <Textarea rows={2} value={challenges} onChange={(e) => setChallenges(e.target.value)} />
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs">Mitigation measures</Label>
                  <Textarea rows={2} value={mitigation} onChange={(e) => setMitigation(e.target.value)} />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setOpenNew(false)}>Cancel</Button>
                <Button onClick={submitNew} disabled={busy}><Upload className="mr-1.5 h-4 w-4" />{busy ? "Saving…" : "Save update"}</Button>
              </div>
            </div>
          </Card>
        )}

        <div className="mt-6">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            <h2 className="font-display text-lg font-bold">Review history</h2>
          </div>
          <div className="mt-3 space-y-3">
            {(reviews ?? []).map((r) => (
              <Card key={r.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-[11px] text-muted-foreground">{new Date(r.created_at).toLocaleString()}</div>
                    <div className="mt-1 font-medium">{r.achievement}</div>
                  </div>
                  <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase ${statusColor(r.progress_status)}`}>{statusLabel(r.progress_status)}</span>
                </div>
                {r.progress_comment && <p className="mt-2 text-sm">{r.progress_comment}</p>}
                <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                  {r.challenges && <div><span className="text-xs text-muted-foreground">Challenges</span><div>{r.challenges}</div></div>}
                  {r.mitigation && <div><span className="text-xs text-muted-foreground">Mitigation</span><div>{r.mitigation}</div></div>}
                </div>
                {r.evidence_path && r.evidence_filename && (
                  <button onClick={() => downloadEvidence(r.evidence_path!, r.evidence_filename!)} className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    <Paperclip className="h-3 w-3" /> {r.evidence_filename}
                  </button>
                )}
                {r.supervisor_comment && (
                  <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">Supervisor comment</div>
                    <p className="mt-1">{r.supervisor_comment}</p>
                    {r.supervisor_commented_at && <div className="mt-1 text-[10px] text-muted-foreground">{new Date(r.supervisor_commented_at).toLocaleString()}</div>}
                  </div>
                )}
                {isSupervisor && (
                  <div className="mt-3">
                    <Button size="sm" variant="outline" onClick={() => addSupervisorComment(r.id, r.supervisor_comment ?? "")}>
                      <MessageCircle className="mr-1.5 h-3 w-3" /> {r.supervisor_comment ? "Edit comment" : "Add comment"}
                    </Button>
                  </div>
                )}
              </Card>
            ))}
            {appraisalId && (!reviews || reviews.length === 0) && (
              <Card className="p-8 text-center text-sm text-muted-foreground">No progress updates yet for this cycle.</Card>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
