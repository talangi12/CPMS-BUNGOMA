import { createFileRoute } from "@tanstack/react-router";
import { PortalLanding } from "@/components/PortalLanding";
import { Gavel, FileText, Users, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/appeals-committee")({
  head: () => ({ meta: [{ title: "Appeals Committee Portal — Bungoma CPMS" }] }),
  component: AppealsCommitteePortal,
});

function AppealsCommitteePortal() {
  const { user } = Route.useRouteContext();
  return (
    <PortalLanding
      userId={user.id}
      title="Appeals Committee Portal"
      description="Review and adjudicate appeals that require committee-level deliberation."
      badge="Appeals Committee"
      actions={[
        { to: "/committee/appeals", label: "Appeal queue", description: "Review and resolve pending committee appeals.", icon: Gavel },
        { to: "/appeals", label: "Appeals overview", description: "Review appeal records and statuses.", icon: FileText },
        { to: "/reports", label: "Reports", description: "Inspect appeal trends and completion metrics.", icon: FileText },
        { to: "/analytics", label: "Analytics", description: "Review appeal and review process statistics.", icon: Users },
        { to: "/dashboard", label: "Dashboard", description: "Return to the general dashboard overview.", icon: ShieldCheck },
      ]}
    />
  );
}
