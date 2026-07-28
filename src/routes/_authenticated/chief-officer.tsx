import { createFileRoute } from "@tanstack/react-router";
import { PortalLanding } from "@/components/PortalLanding";
import { FileText, Users, ShieldCheck, Building2, CalendarDays } from "lucide-react";

export const Route = createFileRoute("/_authenticated/chief-officer")({
  head: () => ({ meta: [{ title: "Chief Officer Portal — Bungoma CPMS" }] }),
  component: ChiefOfficerPortal,
});

function ChiefOfficerPortal() {
  const { user } = Route.useRouteContext();
  return (
    <PortalLanding
      userId={user.id}
      title="Chief Officer Portal"
      description="Manage appraisal sign-off and departmental oversight for your office."
      badge="Chief Officer"
      actions={[
        { to: "/sign-off", label: "Sign-off console", description: "Review approvals for directors and supervisors.", icon: ShieldCheck },
        { to: "/reports", label: "Department reports", description: "Review team progress and completion rates.", icon: FileText },
        { to: "/analytics", label: "Analytics", description: "Inspect performance trends across your office.", icon: Users },
        { to: "/workplans", label: "Workplans", description: "Monitor office workplans and submissions.", icon: Building2 },
        { to: "/contracts", label: "Performance contracts", description: "Track contract completion and approvals.", icon: FileText },
        { to: "/admin/cycles", label: "Cycle management", description: "Coordinate appraisal cycle milestones.", icon: CalendarDays },
      ]}
    />
  );
}
