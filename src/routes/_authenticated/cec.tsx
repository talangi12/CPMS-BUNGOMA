import { createFileRoute } from "@tanstack/react-router";
import { PortalLanding } from "@/components/PortalLanding";
import { FileText, Users, ShieldCheck, CalendarDays, Building2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/cec")({
  head: () => ({ meta: [{ title: "CEC Portal — Bungoma CPMS" }] }),
  component: CecPortal,
});

function CecPortal() {
  const { user } = Route.useRouteContext();
  return (
    <PortalLanding
      userId={user.id}
      title="CEC Portal"
      description="Oversee the county executive appraisal workflow for your department and approve leadership submissions."
      badge="CEC"
      actions={[
        { to: "/sign-off", label: "Sign-off console", description: "Approve or review department submissions.", icon: ShieldCheck },
        { to: "/reports", label: "Department reports", description: "Review department progress and completion status.", icon: FileText },
        { to: "/analytics", label: "Analytics", description: "Inspect department-level performance trends.", icon: Users },
        { to: "/contracts", label: "Performance contracts", description: "Track contract status for assigned departments.", icon: FileText },
        { to: "/workplans", label: "Workplans", description: "Review workplans for department teams.", icon: Building2 },
        { to: "/admin/cycles", label: "Cycle management", description: "Coordinate departmental cycle milestones.", icon: CalendarDays },
      ]}
    />
  );
}
