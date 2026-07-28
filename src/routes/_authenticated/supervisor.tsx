import { createFileRoute } from "@tanstack/react-router";
import { PortalLanding } from "@/components/PortalLanding";
import { FileText, Inbox, ClipboardList, Users, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/supervisor")({
  head: () => ({ meta: [{ title: "Supervisor Portal — Bungoma CPMS" }] }),
  component: SupervisorPortal,
});

function SupervisorPortal() {
  const { user } = Route.useRouteContext();
  return (
    <PortalLanding
      userId={user.id}
      title="Supervisor Portal"
      description="Review team appraisals, inbox items and workplans assigned to your supervision line."
      badge="Supervisor"
      actions={[
        { to: "/supervisor/inbox", label: "Review inbox", description: "Process pending appraisal submissions and feedback.", icon: Inbox },
        { to: "/workplans", label: "Workplans", description: "Review and approve workplans for your team.", icon: ClipboardList },
        { to: "/reports", label: "Reports", description: "Review team progress and completion status.", icon: FileText },
        { to: "/sign-off", label: "Sign-off console", description: "Review and approve office-level sign-off items.", icon: ShieldCheck },
        { to: "/analytics", label: "Analytics", description: "Inspect team performance trends.", icon: Users },
        { to: "/appraisal", label: "My appraisal", description: "Open your own appraisal record and progress.", icon: FileText },
      ]}
    />
  );
}
