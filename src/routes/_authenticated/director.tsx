import { createFileRoute } from "@tanstack/react-router";
import { PortalLanding } from "@/components/PortalLanding";
import { FileText, Users, ShieldCheck, Building2, CalendarDays } from "lucide-react";

export const Route = createFileRoute("/_authenticated/director")({
  head: () => ({ meta: [{ title: "Director Portal — Bungoma CPMS" }] }),
  component: DirectorPortal,
});

function DirectorPortal() {
  const { user } = Route.useRouteContext();
  return (
    <PortalLanding
      userId={user.id}
      title="Director Portal"
      description="Supervise units and teams under your directorate and coordinate approvals."
      badge="Director"
      actions={[
        { to: "/sign-off", label: "Sign-off console", description: "Review and endorse directorate submissions.", icon: ShieldCheck },
        { to: "/reports", label: "Directorate reports", description: "Track completion and quality across the directorate.", icon: FileText },
        { to: "/analytics", label: "Analytics", description: "Inspect performance trends for your directorate.", icon: Users },
        { to: "/workplans", label: "Workplans", description: "Review workplan submissions.", icon: Building2 },
        { to: "/contracts", label: "Performance contracts", description: "Monitor contract status and sign-off progress.", icon: FileText },
        { to: "/admin/cycles", label: "Cycle management", description: "Coordinate cycle milestones for your directorate.", icon: CalendarDays },
      ]}
    />
  );
}
