import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Gavel, Send, Paperclip, X, FileDown } from "lucide-react";

export const Route = createFileRoute("/_authenticated/appeals")({
  head: () => ({ meta: [{ title: "My Appeals — Bungoma CPMS" }] }),
  component: AppealsPage,
});

const STATUS_TONE: Record<string, string> = {
  submitted: "bg-gold/15 text-earth border-gold/40",
  under_review: "bg-primary/10 text-primary border-primary/30",
  upheld: "bg-success/15 text-success border-success/30",
  overturned: "bg-success/15 text-success border-success/30",
  revised: "bg-primary/10 text-primary border-primary/30",
  dismissed: "bg-destructive/15 text-destructive border-destructive/30",
};

const MAX_SIZE = 3 * 1024 * 1024;
const ALLOWED_TYPES = ["application/pdf", "audio/mpeg", "audio/mp3", "video/mp4", "image/jpeg", "image/png"];
const ALLOWED_EXT = ["pdf", "mp3", "mp4", "jpg", "jpeg", "png"];

function AppealsPage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [appraisalId, setAppraisalId] = useState("");
  const [grounds, setGrounds] = useState("");
  const [outcome, setOutcome] = useState("");
  const [pending, setPending] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  const { data: rejected } = useQuery({
    queryKey: ["my-rejected", user.id],
    queryFn: async () => {
      const { data } = await supabase.from("appraisals")
        .select("id, period, status, rejection_reason, total_score, rating")
        .eq("employee_id", user.id)
        .in("status", ["rejected", "approved"])
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: appeals } = useQuery({
    queryKey: ["my-appeals", user.id],
    queryFn: async () => {
      const { data } = await supabase.from("appeals").select("*").eq("appellant_id", user.id).order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  function addFiles(list: FileList | null) {
    if (!list) return;
    const valid: File[] = [];
    for (const f of Array.from(list)) {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      if (f.size > MAX_SIZE) { toast.error(`${f.name}: exceeds 3MB`); continue; }
      if (!ALLOWED_TYPES.includes(f.type) && !ALLOWED_EXT.includes(ext)) {
        toast.error(`${f.name}: only PDF, MP3, MP4, JPEG, PNG allowed`); continue;
      }
      valid.push(f);
    }
    setPending((p) => [...p, ...valid]);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function submit() {
    if (!appraisalId) return toast.error("Pick the appraisal you want to appeal.");
    if (grounds.trim().length < 10) return toast.error("Provide detailed grounds (min 10 characters).");
    setBusy(true);
    try {
      const { data: appeal, error } = await supabase.from("appeals").insert({
        appraisal_id: appraisalId,
        appellant_id: user.id,
        grounds: grounds.trim(),
        desired_outcome: outcome.trim() || null,
      }).select().single();
      if (error) throw error;

      const paths: string[] = [];
      for (const file of pending) {
        const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, "_");
        const path = `${user.id}/${appeal.id}/${Date.now()}-${safeName}`;
        const { error: upErr } = await supabase.storage.from("appeal-evidence").upload(path, file, {
          contentType: file.type, upsert: false,
        });
        if (upErr) { toast.error(`${file.name}: ${upErr.message}`); continue; }
        paths.push(path);
      }
      if (paths.length) {
        await supabase.from("appeals").update({ evidence_paths: paths }).eq("id", appeal.id);
      }
      toast.success("Appeal filed — the Committee has been notified.");
      setAppraisalId(""); setGrounds(""); setOutcome(""); setPending([]);
      qc.invalidateQueries({ queryKey: ["my-appeals", user.id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setBusy(false);
    }
  }

  async function openEvidence(path: string) {
    const { data, error } = await supabase.storage.from("appeal-evidence").createSignedUrl(path, 600);
    if (error || !data) return toast.error("Could not open file");
    window.open(data.signedUrl, "_blank");
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader authenticated userId={user.id} />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-primary">Section 9</div>
          <h1 className="mt-2 font-display text-3xl font-bold">Appeals</h1>
          <p className="mt-1 text-sm text-muted-foreground">File an appeal against an appraisal decision. The Appeals Committee will review and rule.</p>
        </div>

        <Card className="mt-6 p-6">
          <h2 className="font-display text-lg font-bold flex items-center gap-2"><Gavel className="h-4 w-4 text-primary" /> File a new appeal</h2>
          <div className="mt-4 grid gap-4">
            <div>
              <Label className="mb-1.5 block text-xs">Appraisal in question</Label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={appraisalId} onChange={(e) => setAppraisalId(e.target.value)}>
                <option value="">Select an appraisal…</option>
                {(rejected ?? []).map((a) => (
                  <option key={a.id} value={a.id}>{a.period} — {a.status} {a.rating ? `· ${a.rating}` : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Grounds for appeal</Label>
              <Textarea rows={4} value={grounds} onChange={(e) => setGrounds(e.target.value)} placeholder="Explain why you are appealing the decision." />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Desired outcome (optional)</Label>
              <Textarea rows={2} value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="What ruling are you requesting?" />
            </div>

            <div className="rounded-lg border border-dashed border-border p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-primary">Supporting evidence</div>
                  <p className="mt-1 text-xs text-muted-foreground">PDF, MP3, MP4, JPEG or PNG · max 3MB per file</p>
                </div>
                <input ref={fileRef} type="file" multiple hidden
                  accept=".pdf,.mp3,.mp4,.jpg,.jpeg,.png,application/pdf,audio/mpeg,video/mp4,image/jpeg,image/png"
                  onChange={(e) => addFiles(e.target.files)} />
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  <Paperclip className="mr-1.5 h-3.5 w-3.5" /> Attach
                </Button>
              </div>
              {pending.length > 0 && (
                <ul className="mt-3 space-y-1.5 text-sm">
                  {pending.map((f, i) => (
                    <li key={i} className="flex items-center justify-between rounded-md bg-muted/40 px-2.5 py-1.5 text-xs">
                      <span className="truncate">{f.name} · {(f.size / 1024).toFixed(0)} KB</span>
                      <button onClick={() => setPending((p) => p.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-destructive">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex justify-end">
              <Button onClick={submit} disabled={busy}><Send className="mr-1.5 h-4 w-4" /> {busy ? "Submitting…" : "Submit appeal"}</Button>
            </div>
          </div>
        </Card>

        <Card className="mt-6 p-6">
          <h2 className="font-display text-lg font-bold">My appeals</h2>
          {(appeals ?? []).length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No appeals filed.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {appeals!.map((a) => (
                <div key={a.id} className="rounded-lg border border-border p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-muted-foreground">Filed {new Date(a.created_at).toLocaleString()}</div>
                    <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase ${STATUS_TONE[a.status] ?? "border-border"}`}>{a.status.replace("_", " ")}</span>
                  </div>
                  <div className="mt-2 text-sm"><span className="font-semibold">Grounds:</span> {a.grounds}</div>
                  {a.desired_outcome && <div className="mt-1 text-sm"><span className="font-semibold">Desired outcome:</span> {a.desired_outcome}</div>}
                  {a.evidence_paths && a.evidence_paths.length > 0 && (
                    <div className="mt-3">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Evidence</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {a.evidence_paths.map((p: string) => (
                          <button key={p} onClick={() => openEvidence(p)}
                            className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs hover:bg-muted">
                            <FileDown className="h-3 w-3" /> {p.split("/").pop()?.replace(/^\d+-/, "")}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {a.committee_comments && (
                    <div className="mt-3 rounded-md bg-muted/40 p-3 text-sm">
                      <div className="text-xs font-semibold uppercase tracking-wider text-primary">Committee comments</div>
                      <p className="mt-1">{a.committee_comments}</p>
                      {a.ruling && <p className="mt-2"><span className="font-semibold">Ruling:</span> {a.ruling}</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        <p className="mt-6 text-xs text-muted-foreground">
          Need to view an appraisal first? <Link to="/dashboard" className="underline">Open dashboard</Link>.
        </p>
      </main>
    </div>
  );
}
