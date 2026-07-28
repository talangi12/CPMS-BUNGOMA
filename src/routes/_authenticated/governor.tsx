import { createFileRoute } from "@tanstack/react-router";
import { PortalLanding } from "@/components/PortalLanding";
import { FileText, Users, ShieldCheck, Gavel, CalendarDays } from "lucide-react";

export const Route = createFileRoute("/_authenticated/governor")({
  head: () => ({ meta: [{ title: "Governor Portal — Bungoma CPMS" }] }),
  component: GovernorPortal,
});

function GovernorPortal() {
  const { user } = Route.useRouteContext();
  return (
    <PortalLanding
      userId={user.id}
      title="Governor Portal"
      description="Review county-wide appraisal progress, sign off on senior leadership appraisals and oversee strategic approvals."
      badge="Governor"
      actions={[
        { to: "/sign-off", label: "Sign-off console", description: "Review and endorse approvals for senior officers.", icon: ShieldCheck },
        { to: "/reports", label: "County reports", description: "Monitor appraisal compliance and departmental completion.", icon: FileText },
        { to: "/analytics", label: "Analytics", description: "View county-level insights and trends.", icon: Users },
        { to: "/contracts", label: "Performance contracts", description: "Track contract status and endorsements.", icon: FileText },
        { to: "/appeals", label: "Appeals", description: "Review high-level dispute cases.", icon: Gavel },
        { to: "/admin/cycles", label: "Cycle management", description: "Coordinate appraisal cycle milestones and sign-off events.", icon: CalendarDays },
      ]}
    />
  );
}
