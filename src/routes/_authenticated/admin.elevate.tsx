import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { ShieldCheck, Crown } from "lucide-react";
import { toast } from "sonner";
import { useRoles, hasAnyRole, ROLE_LABELS, ROLE_RESPONSIBILITIES, type AppRole } from "@/hooks/useRoles";
import { listMyRoles, toggleSelfRole } from "@/lib/elevate.functions";

export const Route = createFileRoute("/_authenticated/admin/elevate")({
  head: () => ({ meta: [{ title: "Admin · Role Elevation — Bungoma CPMS" }] }),
  component: AdminElevate,
});

const ROLES: AppRole[] = ["employee", "supervisor", "external_assessor", "hr", "system_admin", "super_admin", "appeals_committee", "governor", "cec", "chief_officer", "director"];

function AdminElevate() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const { data: myRoles, isLoading } = useRoles(user.id);
  const allowed = hasAnyRole(myRoles, ["super_admin"]);
  const listFn = useServerFn(listMyRoles);
  const toggleFn = useServerFn(toggleSelfRole);

  const { data: serverRoles, isLoading: loadingRoles } = useQuery({
    queryKey: ["my-server-roles", user.id],
    enabled: allowed,
    queryFn: async () => (await listFn()) as string[],
  });

  if (!isLoading && !allowed) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader authenticated userId={user.id} />
        <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <Card className="p-10 text-center">
            <ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground" />
            <h1 className="mt-3 font-display text-2xl font-bold">Super Admins only</h1>
            <p className="mt-2 text-sm text-muted-foreground">Self role-elevation is restricted to Super Administrators.</p>
          </Card>
        </main>
      </div>
    );
  }

  async function toggle(role: AppRole, enable: boolean) {
    try {
      await toggleFn({ data: { role, enable } });
      toast.success(`${enable ? "Activated" : "Removed"} ${ROLE_LABELS[role]}`);
      qc.invalidateQueries({ queryKey: ["my-server-roles", user.id] });
      qc.invalidateQueries({ queryKey: ["roles", user.id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  const active = new Set(serverRoles ?? []);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader authenticated userId={user.id} />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-primary">Administration</div>
          <h1 className="mt-2 flex items-center gap-2 font-display text-3xl font-bold">
            <Crown className="h-7 w-7 text-primary" /> Self Role Elevation
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One-click activate or revoke any role on your own account. Every toggle is recorded in the audit log.
          </p>
        </div>

        <Card className="mt-6 p-5">
          {loadingRoles ? (
            <p className="text-center text-sm text-muted-foreground">Loading current roles…</p>
          ) : (
            <ul className="divide-y divide-border">
              {ROLES.map((r) => {
                const isActive = active.has(r);
                const isLocked = r === "super_admin"; // safety: can't drop super_admin here
                return (
                  <li key={r} className="flex items-start justify-between gap-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{ROLE_LABELS[r]}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{ROLE_RESPONSIBILITIES[r]}</div>
                      {isLocked && (
                        <div className="mt-1 text-[10px] uppercase tracking-wider text-gold-foreground">
                          Locked — manage Super Admin from a separate account
                        </div>
                      )}
                    </div>
                    <Switch
                      checked={isActive}
                      disabled={isLocked && isActive}
                      onCheckedChange={(v) => toggle(r, v)}
                      aria-label={`Toggle ${ROLE_LABELS[r]}`}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <p className="mt-4 text-xs text-muted-foreground">
          Tip: Use this to inspect another role's experience (e.g. switch on Director to test the Director dashboard), then switch it off when done.
        </p>
      </main>
    </div>
  );
}
