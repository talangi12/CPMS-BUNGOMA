import { createFileRoute } from "@tanstack/react-router";
import { PortalLanding } from "@/components/PortalLanding";
import { Crown, ShieldCheck, Users, FileText, Database } from "lucide-react";

export const Route = createFileRoute("/_authenticated/super-admin")({
  head: () => ({ meta: [{ title: "Super Admin Portal — Bungoma CPMS" }] }),
  component: SuperAdminPortal,
});

function SuperAdminPortal() {
  const { user } = Route.useRouteContext();
  return (
    <PortalLanding
      userId={user.id}
      title="Super Admin Portal"
      description="Access the highest level control plane for the system with full administrative oversight."
      badge="Super Admin"
      actions={[
        { to: "/admin", label: "Admin console", description: "Access the full admin control plane.", icon: ShieldCheck },
        { to: "/admin/users", label: "User management", description: "Create and manage system-wide users and roles.", icon: Users },
        { to: "/admin/elevate", label: "Role elevation", description: "Temporarily elevate access for testing and support.", icon: Crown },
        { to: "/admin/audit", label: "Audit trail", description: "Inspect full system and role change history.", icon: FileText },
        { to: "/admin/sync", label: "Sync operations", description: "Run and review system synchronization tasks.", icon: Database },
      ]}
    />
  );
}
