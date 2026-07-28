import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { RatingBadge, classify } from "@/components/RatingBadge";
import { ArrowRight, CalendarClock, ClipboardCheck, FileText, Target, TrendingUp, GraduationCap, Inbox, ShieldCheck, UserCog, Gavel, UserPlus } from "lucide-react";
import { useRoles, hasAnyRole, ROLE_LABELS, ROLE_RESPONSIBILITIES } from "@/hooks/useRoles";
import { DashboardStatsPopup } from "@/components/DashboardStatsPopup";
import { AppraisalCalendar } from "@/components/AppraisalCalendar";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Bungoma CPMS" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { user } = Route.useRouteContext();
  const { data: roles } = useRoles(user.id);
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel(`dashboard-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "appraisals" }, () => {
        queryClient.invalidateQueries({ queryKey: ["dashboard", user.id] });
        queryClient.invalidateQueries({ queryKey: ["role-stats", user.id] });
        queryClient.invalidateQueries({ queryKey: ["reports-rows", user.id] });
        queryClient.invalidateQueries({ queryKey: ["supervisor-inbox", user.id] });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, () => {
        queryClient.invalidateQueries({ queryKey: ["notifications", user.id] });
        queryClient.invalidateQueries({ queryKey: ["dashboard", user.id] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user.id, queryClient]);



  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", user.id],
    queryFn: async () => {
      const [{ data: profile }, { data: appraisals }, supInbox] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
        supabase.from("appraisals").select("*, targets(weight, score)").eq("employee_id", user.id).order("created_at", { ascending: false }),
        supabase.from("appraisals").select("id, status").eq("chosen_supervisor_id", user.id).eq("status", "submitted"),
      ]);
      return { profile, appraisals: appraisals ?? [], pendingReviews: supInbox.data?.length ?? 0 };
    },
  });

  const current = data?.appraisals[0];
  const totalWeight = current?.targets?.reduce((a: number, t: { weight: number | null }) => a + (Number(t.weight) || 0), 0) ?? 0;
  const weightedScore = current?.targets?.reduce(
    (a: number, t: { weight: number | null; score: number | null }) => a + (Number(t.weight) || 0) * (Number(t.score) || 0),
    0,
  ) ?? 0;
  const livePct = totalWeight > 0 ? weightedScore / totalWeight : null;
  const liveRating = classify(livePct);

  const isSupervisor = hasAnyRole(roles, ["supervisor"]);
  const isAdmin = hasAnyRole(roles, ["system_admin", "super_admin"]);
  const primaryRole = roles?.[0] ?? "employee";

  return (
    <div className="min-h-screen bg-background">
      <AppHeader authenticated userId={user.id} />
      <DashboardStatsPopup userId={user.id} />



      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 space-y-6">
        <AppraisalCalendar userId={user.id} />
        {/* Welcome */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-primary">{ROLE_LABELS[primaryRole]} workspace</div>
            <h1 className="mt-2 font-display text-3xl font-bold sm:text-4xl">
              Karibu, <span className="text-primary">{data?.profile?.full_name?.split(" ")[0] ?? "Officer"}</span>.
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {data?.profile?.designation ?? "Officer"} · {data?.profile?.department ?? "—"} · Emp. {data?.profile?.employee_no ?? "—"}
            </p>
          </div>
          <Link to="/appraisal">
            <Button className="shadow-elegant">
              {current ? "Continue appraisal" : "Start appraisal"} <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          </Link>
        </div>

        {/* Role responsibilities + quick links */}
        <Card className="mt-6 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <div className="text-xs font-semibold uppercase tracking-wider text-primary">Your responsibilities</div>
              <p className="mt-1 text-sm">{ROLE_RESPONSIBILITIES[primaryRole]}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {isSupervisor && (
                <Link to="/supervisor/inbox" className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10">
                  <Inbox className="h-3.5 w-3.5" /> Review Inbox{data?.pendingReviews ? ` (${data.pendingReviews})` : ""}
                </Link>
              )}
              <Link to="/midyear" className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
                <CalendarClock className="h-3.5 w-3.5" /> Mid-Year Review
              </Link>
              <Link to="/appeals" className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
                <Gavel className="h-3.5 w-3.5" /> Appeals
              </Link>
              {hasAnyRole(roles, ["appeals_committee", "super_admin"]) && (
                <Link to="/committee/appeals" className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
                  <Gavel className="h-3.5 w-3.5" /> Committee
                </Link>
              )}
              {isAdmin && (
                <>
                  <Link to="/admin/roles" className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
                    <UserCog className="h-3.5 w-3.5" /> Manage roles
                  </Link>
                  <Link to="/admin/users" className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
                    <UserPlus className="h-3.5 w-3.5" /> Create user
                  </Link>
                </>
              )}
              {hasAnyRole(roles, ["hr", "super_admin"]) && (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground">
                  <ShieldCheck className="h-3.5 w-3.5" /> HR oversight enabled
                </span>
              )}
            </div>
          </div>
        </Card>


        {/* Stat cards */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={ClipboardCheck} label="Current status" value={current?.status?.toUpperCase() ?? "NOT STARTED"} tone="primary" />
          <StatCard icon={Target} label="Targets set" value={String(current?.targets?.length ?? 0)} />
          <StatCard icon={TrendingUp} label="Live score" value={livePct != null ? `${livePct.toFixed(1)}%` : "—"} />
          <StatCard icon={CalendarClock} label="Cycle" value={current?.period ?? new Date().getFullYear().toString()} />
        </div>

        {/* Main grid */}
        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          {/* Performance card */}
          <Card className="p-6 lg:col-span-2">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-display text-lg font-bold">Current performance</h2>
                <p className="text-sm text-muted-foreground">Section 8 — Performance Rating Matrix (auto-calculated)</p>
              </div>
              <RatingBadge rating={liveRating ?? undefined} score={livePct ?? undefined} />
            </div>

            <div className="mt-6">
              <Progress value={Math.min(livePct ?? 0, 100)} className="h-3" />
              <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                <span>0%</span><span>50% Fair</span><span>65% Good</span><span>85% Very Good</span><span>101%+ Excellent</span>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3 text-center text-xs sm:grid-cols-5">
              {[
                ["Poor", "≤49%"],
                ["Fair", "50-64%"],
                ["Good", "65-84%"],
                ["Very Good", "85-100%"],
                ["Excellent", "101%+"],
              ].map(([l, r]) => (
                <div key={l} className={`rounded-lg border p-3 ${liveRating === l ? "border-primary bg-primary/5" : "border-border bg-muted/30"}`}>
                  <div className={`font-display text-sm font-bold ${liveRating === l ? "text-primary" : ""}`}>{l}</div>
                  <div className="text-muted-foreground">{r}</div>
                </div>
              ))}
            </div>
          </Card>

          {/* Pending */}
          <Card className="p-6">
            <h2 className="font-display text-lg font-bold">Pending actions</h2>
            <ul className="mt-4 space-y-3 text-sm">
              {!current && (
                <ActionItem to="/appraisal" icon={Target} title="Set your performance targets" desc="Section 2A — minimum 4 targets" />
              )}
              {current && !current.employee_signed_at && (
                <ActionItem to="/appraisal" icon={FileText} title="Sign target agreement" desc="Section 2C — digital signature" />
              )}
              <ActionItem to="/appraisal" icon={GraduationCap} title="Update training needs" desc="Section 2B — skill gaps" />
              {current?.status === "submitted" && (
                <li className="rounded-lg border border-gold/40 bg-gold/10 p-3 text-foreground">
                  <div className="text-xs font-semibold text-earth">Awaiting supervisor review</div>
                </li>
              )}
            </ul>
          </Card>
        </div>

        {/* History */}
        <Card className="mt-8 p-6">
          <h2 className="font-display text-lg font-bold">Appraisal history</h2>
          {isLoading ? (
            <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
          ) : data?.appraisals.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-border bg-muted/30 p-8 text-center">
              <p className="text-sm text-muted-foreground">No appraisals yet. Start your first cycle to track performance over time.</p>
              <Link to="/appraisal" className="mt-4 inline-block"><Button variant="outline">Start now</Button></Link>
            </div>
          ) : (
            <table className="mt-4 w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr><th className="py-2">Period</th><th>Status</th><th>Score</th><th>Rating</th></tr>
              </thead>
              <tbody>
                {data?.appraisals.map((a) => (
                  <tr key={a.id} className="border-t border-border">
                    <td className="py-3 font-medium">{a.period}</td>
                    <td className="capitalize">{a.status}</td>
                    <td>{a.total_score != null ? `${a.total_score}%` : "—"}</td>
                    <td><RatingBadge rating={a.rating ?? undefined} /></td>
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

function StatCard({ icon: Icon, label, value, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; tone?: "primary" }) {
  return (
    <Card className="p-5">
      <div className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${tone === "primary" ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="mt-3 text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold">{value}</div>
    </Card>
  );
}

function ActionItem({ to, icon: Icon, title, desc }: { to: string; icon: React.ComponentType<{ className?: string }>; title: string; desc: string }) {
  return (
    <li>
      <Link to={to} className="flex items-start gap-3 rounded-lg border border-border p-3 transition hover:border-primary/40 hover:bg-muted/40">
        <Icon className="mt-0.5 h-4 w-4 text-primary" />
        <div className="flex-1">
          <div className="font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">{desc}</div>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
      </Link>
    </li>
  );
}
