import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ShieldCheck, UserCog, Plus, X } from "lucide-react";
import { useRoles, hasAnyRole, ROLE_LABELS, ROLE_RESPONSIBILITIES, type AppRole } from "@/hooks/useRoles";

export const Route = createFileRoute("/_authenticated/admin/roles")({
  head: () => ({ meta: [{ title: "Admin · Roles — Bungoma CPMS" }] }),
  component: AdminRoles,
});

const ASSIGNABLE: AppRole[] = ["employee", "supervisor", "hr", "system_admin", "super_admin", "appeals_committee", "governor", "cec", "chief_officer", "director", "dept_admin"];
const DEPT_SCOPED: AppRole[] = ["dept_admin", "cec", "chief_officer", "director", "supervisor"];

function AdminRoles() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const { data: myRoles, isLoading: rolesLoading } = useRoles(user.id);
  const [filter, setFilter] = useState("");

  const allowed = hasAnyRole(myRoles, ["system_admin", "super_admin"]);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users"],
    enabled: allowed,
    queryFn: async () => {
      const [
  { data: profiles, error: profilesError },
  { data: roles, error: rolesError }
] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email, designation, department").order("full_name"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      const rmap = new Map<string, AppRole[]>();
      (roles ?? []).forEach((r) => {
        const list = rmap.get(r.user_id) ?? [];
        list.push(r.role as AppRole);
        rmap.set(r.user_id, list);
      });
      console.log("========== ADMIN USERS ==========");
console.log("profiles length:", profiles?.length);
console.log("profiles:", profiles);
console.log("profiles error:", profilesError);
console.log("roles length:", roles?.length);
console.log("roles:", roles);
console.log("roles error:", rolesError);
console.log("=================================");

return (profiles ?? []).map((p) => ({ ...p, roles: rmap.get(p.id) ?? [] }));
    },
  });

  if (!rolesLoading && !allowed) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader authenticated userId={user.id} />
        <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <Card className="p-10 text-center">
            <ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground" />
            <h1 className="mt-3 font-display text-2xl font-bold">Admin access required</h1>
            <p className="mt-2 text-sm text-muted-foreground">Only System Admins and Super Admins can manage roles.</p>
          </Card>
        </main>
      </div>
    );
  }

  async function addRole(userId: string, role: AppRole, department: string | null) {
    const payload: { user_id: string; role: AppRole; department?: string } = { user_id: userId, role };
    if (DEPT_SCOPED.includes(role) && department) payload.department = department;
    const { error } = await supabase.from("user_roles").insert(payload);
    if (error) return toast.error(error.message);
    toast.success(`Granted ${ROLE_LABELS[role]}${payload.department ? ` (${payload.department})` : ""}`);
    qc.invalidateQueries({ queryKey: ["admin-users"] });
  }
  async function removeRole(userId: string, role: AppRole) {
    const { error } = await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", role);
    if (error) return toast.error(error.message);
    toast.success(`Removed ${ROLE_LABELS[role]}`);
    qc.invalidateQueries({ queryKey: ["admin-users"] });
  }

  const filtered = (data ?? []).filter((u) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return u.full_name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q) || u.department?.toLowerCase().includes(q);
  });

  return (
    <div className="min-h-screen bg-background">
      <AppHeader authenticated userId={user.id} />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-primary">Administration</div>
            <h1 className="mt-2 font-display text-3xl font-bold">User roles</h1>
            <p className="mt-1 text-sm text-muted-foreground">Assign roles to county users. Each role grants specific responsibilities in the CPMS.</p>
          </div>
        </div>

        <Card className="mt-6 p-5">
          <h2 className="font-display text-sm font-bold">Role reference</h2>
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
            {ASSIGNABLE.map((r) => (
              <div key={r} className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-center gap-1.5 font-semibold text-primary"><UserCog className="h-3 w-3" /> {ROLE_LABELS[r]}</div>
                <div className="mt-1 text-muted-foreground">{ROLE_RESPONSIBILITIES[r]}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="mt-6 p-5">
          <div className="flex items-center justify-between gap-3">
            <Input placeholder="Search by name, email, department…" value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-sm" />
            <span className="text-xs text-muted-foreground">{filtered.length} users</span>
          </div>

          {isLoading ? (
            <p className="mt-6 text-center text-sm text-muted-foreground">Loading users…</p>
          ) : (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr><th className="py-2">User</th><th>Department</th><th>Roles</th><th>Grant role</th></tr>
                </thead>
                <tbody>
                  {filtered.map((u) => {
                    const available = ASSIGNABLE.filter((r) => !u.roles.includes(r));
                    return (
                      <tr key={u.id} className="border-t border-border align-top">
                        <td className="py-3">
                          <div className="font-medium">{u.full_name}</div>
                          <div className="text-xs text-muted-foreground">{u.email}</div>
                        </td>
                        <td className="py-3">{u.department ?? "—"}</td>
                        <td className="py-3">
                          <div className="flex flex-wrap gap-1">
                            {u.roles.length === 0 && <span className="text-xs text-muted-foreground">none</span>}
                            {u.roles.map((r) => (
                              <Badge key={r} variant="secondary" className="gap-1">
                                {ROLE_LABELS[r]}
                                <button onClick={() => removeRole(u.id, r)} aria-label={`Remove ${r}`} className="ml-1 rounded-sm hover:bg-destructive/20">
                                  <X className="h-3 w-3" />
                                </button>
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="py-3">
                          <div className="flex flex-wrap gap-1">
                            {available.map((r) => (
                              <Button key={r} size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => {
                                const dept = DEPT_SCOPED.includes(r) ? (window.prompt(`Department to scope "${ROLE_LABELS[r]}" to (leave blank for county-wide):`, u.department ?? "") ?? "") : "";
                                addRole(u.id, r, dept || null);
                              }}>
                                <Plus className="h-3 w-3" /> {ROLE_LABELS[r]}
                              </Button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}

