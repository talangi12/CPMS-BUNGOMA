import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useRoles, hasAnyRole } from "@/hooks/useRoles";
import { Gavel, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/committee/appeals")({
  head: () => ({ meta: [{ title: "Appeals Committee — Bungoma CPMS" }] }),
  component: CommitteePage,
});

const RULINGS = ["upheld", "overturned", "revised", "dismissed"] as const;

function CommitteePage() {
  const { user } = Route.useRouteContext();
  const { data: roles, isLoading: rl } = useRoles(user.id);
  const allowed = hasAnyRole(roles, ["appeals_committee", "super_admin"]);
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, { comments: string; ruling: string }>>({});

  const { data: appeals } = useQuery({
    queryKey: ["committee-appeals"],
    enabled: allowed,
    queryFn: async () => {
      const { data } = await supabase
        .from("appeals")
        .select("*, profiles:appellant_id(full_name, department)")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  if (!rl && !allowed) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader authenticated userId={user.id} />
        <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <Card className="p-10 text-center">
            <ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground" />
            <h1 className="mt-3 font-display text-2xl font-bold">Committee access only</h1>
            <p className="mt-2 text-sm text-muted-foreground">This page is restricted to members of the Appeals Committee.</p>
          </Card>
        </main>
      </div>
    );
  }

  async function rule(id: string) {
    const d = drafts[id];
    if (!d?.ruling) return toast.error("Choose a ruling.");
    const { error } = await supabase.from("appeals").update({
      status: d.ruling,
      ruling: d.ruling,
      committee_comments: d.comments,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Ruling recorded");
    qc.invalidateQueries({ queryKey: ["committee-appeals"] });
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader authenticated userId={user.id} />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-primary">Appeals Committee</div>
          <h1 className="mt-2 font-display text-3xl font-bold flex items-center gap-2"><Gavel className="h-7 w-7 text-primary" /> Pending appeals</h1>
        </div>

        <div className="mt-6 space-y-4">
          {(appeals ?? []).length === 0 && (
            <Card className="p-10 text-center text-sm text-muted-foreground">No appeals to review.</Card>
          )}
          {appeals?.map((a) => {
            const d = drafts[a.id] ?? { comments: a.committee_comments ?? "", ruling: a.ruling ?? "" };
            const finalized = ["upheld","overturned","revised","dismissed"].includes(a.status);
            const prof = a.profiles as { full_name?: string; department?: string } | null;
            return (
              <Card key={a.id} className="p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs text-muted-foreground">Filed {new Date(a.created_at).toLocaleString()}</div>
                    <div className="mt-1 font-display text-lg font-bold">{prof?.full_name ?? "Appellant"}</div>
                    <div className="text-xs text-muted-foreground">{prof?.department ?? "—"}</div>
                  </div>
                  <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold uppercase">{a.status.replace("_", " ")}</span>
                </div>
                <div className="mt-3 text-sm"><span className="font-semibold">Grounds:</span> {a.grounds}</div>
                {a.desired_outcome && <div className="mt-1 text-sm"><span className="font-semibold">Desired:</span> {a.desired_outcome}</div>}

                <div className="mt-4 grid gap-3">
                  <div>
                    <Label className="mb-1 block text-xs">Committee comments</Label>
                    <Textarea rows={3} disabled={finalized} value={d.comments}
                      onChange={(e) => setDrafts((p) => ({ ...p, [a.id]: { ...d, comments: e.target.value } }))} />
                  </div>
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <Label className="mb-1 block text-xs">Ruling</Label>
                      <div className="flex flex-wrap gap-2">
                        {RULINGS.map((r) => (
                          <button key={r} disabled={finalized}
                            onClick={() => setDrafts((p) => ({ ...p, [a.id]: { ...d, ruling: r } }))}
                            className={`rounded-md border px-3 py-1.5 text-xs capitalize ${d.ruling === r ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"} ${finalized ? "opacity-50" : ""}`}>
                            {r}
                          </button>
                        ))}
                      </div>
                    </div>
                    {!finalized && <Button onClick={() => rule(a.id)}>Submit ruling</Button>}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </main>
    </div>
  );
}
