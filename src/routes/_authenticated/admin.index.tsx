import type { ComponentType } from "react";
import { requireAdmin } from "@/lib/authGuard";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useRoles, hasAdminAccess } from "@/hooks/useRoles";
import { ShieldCheck, UserCog, UserPlus, Users, Gavel, FileText, ClipboardCheck, BarChart3, CalendarDays, ScrollText, UploadCloud, Search as SearchIcon, Database, Building2, Activity, FileWarning, Crown } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/")({
  beforeLoad: async () => {
    await requireAdmin();
  },

  head: () => ({
    meta: [{ title: "Admin Console — Bungoma CPMS" }],
  }),

  component: AdminHome,
});

function AdminHome() {
  const { user } = Route.useRouteContext();
  const { data: roles, isLoading } = useRoles(user.id);
  const { data: profile } = useQuery({
    queryKey: ["admin-profile-hint", user.id],
    enabled: !!user.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("designation, id_number, email")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const allowed = hasAdminAccess(roles) || hasAdminAccess([profile?.designation, profile?.id_number, profile?.email]);

  const { data: stats } = useQuery({
    queryKey: ["admin-stats"],
    enabled: allowed,
    queryFn: async () => {
      const [usersResult, appraisalsResult, submittedResult, approvedResult, appealsResult] = await Promise.all([
        supabase.from("profiles").select("id"),
        supabase.from("appraisals").select("id", { count: "exact", head: true }),
        supabase.from("appraisals").select("id", { count: "exact", head: true }).eq("status", "submitted"),
        supabase.from("appraisals").select("id", { count: "exact", head: true }).eq("status", "approved"),
        supabase.from("appeals").select("id", { count: "exact", head: true }),
      ]);

      return {
        users: usersResult.data?.length ?? 0,
        appraisals: appraisalsResult.count ?? 0,
        submitted: submittedResult.count ?? 0,
        approved: approvedResult.count ?? 0,
        appeals: appealsResult.count ?? 0,
      };
    },
  });

  if (!isLoading && !allowed) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader authenticated userId={user.id} />
        <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <Card className="p-10 text-center">
            <ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground" />
            <h1 className="mt-3 font-display text-2xl font-bold">Admin access required</h1>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader authenticated userId={user.id} />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-primary">Administration</div>
          <h1 className="mt-2 font-display text-3xl font-bold">Admin Console</h1>
          <p className="mt-1 text-sm text-muted-foreground">Control plane for the County CPMS. Manage users, roles, appraisal cycles and appeals.</p>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Stat icon={Users} label="Registered users" value={stats?.users ?? "—"} />
          <Stat icon={FileText} label="Total appraisals" value={stats?.appraisals ?? "—"} />
          <Stat icon={ClipboardCheck} label="Awaiting review" value={stats?.submitted ?? "—"} />
          <Stat icon={BarChart3} label="Approved" value={stats?.approved ?? "—"} />
          <Stat icon={Gavel} label="Appeals filed" value={stats?.appeals ?? "—"} />
        </div>

        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <AdminCard to="/admin/import" icon={UploadCloud} title="Bulk employee import"
            desc="Drag-drop CSV or Excel. Pre-import preview, validation report and direct insertion into the database." />
          <AdminCard to="/admin/status" icon={Activity} title="Employee status management"
            desc="Change lifecycle status (Active, Suspended, Transferred, Retired, Terminated) with full audit." />
          <AdminCard to="/admin/contracts" icon={FileWarning} title="Contract lifecycle"
            desc="Monitor contract employees, auto-archive expired contracts, renew, extend or terminate." />
          <AdminCard to="/admin/sync" icon={Database} title="Payroll synchronization"
            desc="Schedule daily/weekly sync, run on-demand syncs, and inspect the run history." />
          <AdminCard to="/admin/org-structure" icon={Building2} title="Organisational structure"
            desc="Auto-generated hierarchy of directorates → departments → sections → units." />
          <AdminCard to="/search" icon={SearchIcon} title="Employee search"
            desc="Look up any employee by ID Number or Personal Number, scoped by your departmental authority." />
          <AdminCard to="/admin/users" icon={UserPlus} title="Create user account"
            desc="Provision HR officers, supervisors, directors, chief officers, governor, system admins and committee members." />
          <AdminCard to="/admin/roles" icon={UserCog} title="Manage roles"
            desc="Grant or revoke EPMS roles for any registered user. Search by name, email, employee number." />
          <AdminCard to="/admin/elevate" icon={Crown} title="Self role elevation"
            desc="Super Admin only — one-click toggle any role on your own account to test other dashboards. Audit-logged." />
          <AdminCard to="/admin/cycles" icon={CalendarDays} title="Appraisal cycles"
            desc="Open the FY cycle, capture Governor approval and activate departments." />
          <AdminCard to="/dept-admin" icon={ClipboardCheck} title="Departmental Administrator portal"
            desc="Landing page for Departmental Administrators — matrix, sources, categories, department views." />
          <AdminCard to="/admin/matrix" icon={ClipboardCheck} title="Performance Matrix (Dept Admin)"
            desc="Add, edit, reorder, activate/deactivate performance targets and Source dropdown values." />

          <AdminCard to="/admin/audit" icon={ScrollText} title="Audit logs"
            desc="Every role change, signature, approval and reset — searchable trail." />
          <AdminCard to="/admin/login-audit" icon={ScrollText} title="Login audit"
            desc="Every successful and failed sign-in attempt, with IP and user-agent details." />
          <AdminCard to="/committee/appeals" icon={Gavel} title="Appeals committee queue"
            desc="Review filed appeals and issue rulings." />
          <AdminCard to="/supervisor/inbox" icon={ClipboardCheck} title="Supervisor inbox"
            desc="Open the supervisor review workspace." />
          <AdminCard to="/midyear" icon={FileText} title="Mid-Year reviews"
            desc="Monitor mid-cycle progress across teams." />
          <AdminCard to="/endyear" icon={FileText} title="End-Year reviews"
            desc="Final cycle scoring and self-assessment statements." />
        </div>
      </main>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number | string }) {
  return (
    <Card className="p-4">
      <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-display text-2xl font-bold">{value}</div>
    </Card>
  );
}

function AdminCard({ to, icon: Icon, title, desc }: { to: string; icon: React.ComponentType<{ className?: string }>; title: string; desc: string }) {
  return (
    <Card className="p-5">
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-3 font-display text-base font-bold">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
      <Link to={to} className="mt-3 inline-block"><Button size="sm" variant="outline">Open</Button></Link>
    </Card>
  );
}
