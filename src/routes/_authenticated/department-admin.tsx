import { createFileRoute } from "@tanstack/react-router";
import { PortalLanding } from "@/components/PortalLanding";
import { ClipboardCheck, FileText, Users, Building2, BarChart3 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/department-admin")({
  head: () => ({ meta: [{ title: "Department Admin Portal — Bungoma CPMS" }] }),
  component: DepartmentAdminPortal,
});

function DepartmentAdminPortal() {
  const { user } = Route.useRouteContext();
  return (
    <PortalLanding
      userId={user.id}
      title="Departmental Administrator Portal"
      description="Manage the departmental performance matrix, reports and departmental workplans."
      badge="Departmental Administrator"
      actions={[
        { to: "/admin/matrix", label: "Performance matrix", description: "Add, edit and manage the departmental matrix entries.", icon: ClipboardCheck },
        { to: "/reports", label: "Departmental reports", description: "Inspect reports scoped to your department.", icon: FileText },
        { to: "/analytics", label: "Departmental analytics", description: "Review department completion and rating trends.", icon: BarChart3 },
        { to: "/workplans", label: "Departmental workplans", description: "View and manage workplans for your department.", icon: Building2 },
        { to: "/admin/contracts", label: "Departmental contracts", description: "Monitor performance contracts in your department.", icon: FileText },
        { to: "/admin/users", label: "Department users", description: "View departmental user records.", icon: Users },
      ]}
    />
  );
}
