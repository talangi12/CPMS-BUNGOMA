import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { RatingBadge } from "@/components/RatingBadge";
import { Inbox, ArrowRight } from "lucide-react";
import { useRoles, hasAnyRole } from "@/hooks/useRoles";

export const Route = createFileRoute("/_authenticated/supervisor/inbox")({
  head: () => ({ meta: [{ title: "Review Inbox — Bungoma CPMS" }] }),
  component: SupervisorInbox,
});

function SupervisorInbox() {
  const { user } = Route.useRouteContext();
  const { data: roles, isLoading: rolesLoading } = useRoles(user.id);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["supervisor-inbox", user.id],
    enabled: hasAnyRole(roles, ["supervisor","chief_officer"]),
    queryFn: async () => {
      const { data: own } = await supabase
        .from("appraisals")
        .select("id, period, status, total_score, rating, employee_id, created_at, employee_signed_at, supervisor_reviewed_at")
        .eq("chosen_supervisor_id", user.id)
        .order("created_at", { ascending: false });
      const merged = own ?? [];
      const ids = Array.from(new Set(merged.map((a) => a.employee_id)));
      const profiles = ids.length
        ? (await supabase.from("profiles").select("id, full_name, designation, department").in("id", ids)).data ?? []
        : [];
      const pmap = new Map(profiles.map((p) => [p.id, p]));
      return merged.map((a) => ({ ...a, profile: pmap.get(a.employee_id) }));
    },
  });

  if (!rolesLoading && !hasAnyRole(roles, ["supervisor","chief_officer"])) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader authenticated userId={user.id} />
        <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <Card className="p-10 text-center">
            <h1 className="font-display text-2xl font-bold">Supervisor access required</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              You don't have the supervisor role. Contact a System Admin to be granted supervisor access.
            </p>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader authenticated userId={user.id} />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-primary">Supervisor workspace</div>
            <h1 className="mt-2 font-display text-3xl font-bold">Review Inbox</h1>
            <p className="mt-1 text-sm text-muted-foreground">Appraisals assigned to you for review.</p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs">
            <Inbox className="h-3.5 w-3.5" /> {items.length} total
          </div>
        </div>

        <Card className="mt-6 overflow-hidden">
          {isLoading ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Loading inbox…</div>
          ) : items.length === 0 ? (
            <div className="p-12 text-center">
              <Inbox className="mx-auto h-10 w-10 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">No appraisals assigned to you yet.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Period</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="font-medium">{a.profile?.full_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{a.profile?.designation} · {a.profile?.department}</div>
                    </td>
                    <td className="px-4 py-3">{a.period}</td>
                    <td className="px-4 py-3">
                      <StatusPill status={a.status} />
                    </td>
                    <td className="px-4 py-3"><RatingBadge rating={a.rating ?? undefined} score={a.total_score != null ? Number(a.total_score) : undefined} /></td>
                    <td className="px-4 py-3 text-right">
                      <Link to="/supervisor/review/$id" params={{ id: a.id }} className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5">
                        Open <ArrowRight className="h-3 w-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </main>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tones: Record<string, string> = {
    draft: "bg-muted text-foreground",
    submitted: "bg-gold/20 text-earth border border-gold/40",
    approved: "bg-primary/15 text-primary border border-primary/30",
    rejected: "bg-destructive/15 text-destructive border border-destructive/30",
  };
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider ${tones[status] ?? "bg-muted"}`}>{status}</span>;
}
