import { createFileRoute, Link } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useRoles, hasAnyRole, useRoleRows } from "@/hooks/useRoles";
import { ClipboardCheck, FileText, Users, ShieldCheck, BarChart3, Building2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dept-admin")({
  head: () => ({ meta: [{ title: "Departmental Administrator Portal — Bungoma CPMS" }] }),
  component: DeptAdminPortal,
});

function DeptAdminPortal() {
  const { user } = Route.useRouteContext();
  const { data: roles, isLoading } = useRoles(user.id);
  const { data: rows } = useRoleRows(user.id);
  const isDeptAdmin = hasAnyRole(roles, ["dept_admin"]);
  const isSysAdmin = hasAnyRole(roles, ["system_admin", "super_admin"]);
  const allowed = isDeptAdmin || isSysAdmin;
  const myDepartments = (rows ?? []).filter((r) => r.role === "dept_admin").map((r) => r.department).filter(Boolean) as string[];

  if (!isLoading && !allowed) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader authenticated userId={user.id} />
        <main className="mx-auto max-w-3xl px-4 py-16">
          <Card className="p-10 text-center">
            <ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground" />
            <h1 className="mt-3 font-display text-2xl font-bold">Departmental Administrator access required</h1>
            <p className="mt-2 text-sm text-muted-foreground">Ask your System Administrator to assign the Departmental Administrator role for your department.</p>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader authenticated userId={user.id} />
      <main className="mx-auto max-w-6xl px-4 py-10">
        <div className="text-xs font-semibold uppercase tracking-widest text-primary">Departmental Administrator</div>
        <h1 className="mt-2 font-display text-3xl font-bold">Departmental Administrator Portal</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage the departmental Performance Matrix, source dropdown values and view departmental reports, workplans and contracts.
        </p>
        {myDepartments.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Assigned department{myDepartments.length > 1 ? "s" : ""}: <span className="font-medium text-foreground">{myDepartments.join(", ")}</span>
          </p>
        )}

        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Tile to="/admin/matrix" icon={ClipboardCheck} title="Performance Matrix"
            desc="Add, edit and reorder Target · Unit · Weight · Type · Source rows. Manage categories and Source dropdown values." />
          <Tile to="/reports" icon={FileText} title="Departmental reports"
            desc="View appraisal, contract and workplan reports scoped to your department." />
          <Tile to="/analytics" icon={BarChart3} title="Departmental analytics"
            desc="Department-level completion, ratings, and top performers." />
          <Tile to="/workplans" icon={Building2} title="Departmental workplans"
            desc="View employee workplans across your department." />
          <Tile to="/admin/contracts" icon={FileText} title="Departmental contracts"
            desc="Monitor Performance Contracts owned by officers in your department." />
          <Tile to="/admin/users" icon={Users} title="Departmental users"
            desc="View users in your department (edit permissions require System Admin approval)." />
        </div>

        <div className="mt-8 text-xs text-muted-foreground">
          Departmental Administrators cannot edit officers' Performance Contracts, only the underlying matrix and source dropdown values.
        </div>
      </main>
    </div>
  );
}

function Tile({ to, icon: Icon, title, desc }: { to: string; icon: React.ComponentType<{ className?: string }>; title: string; desc: string }) {
  return (
    <Card className="p-5">
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Icon className="h-5 w-5" /></div>
      <h3 className="mt-3 font-display text-base font-bold">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
      <Link to={to} className="mt-3 inline-block"><Button size="sm" variant="outline">Open</Button></Link>
    </Card>
  );
}
