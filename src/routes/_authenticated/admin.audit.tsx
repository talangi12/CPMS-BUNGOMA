import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useRoles, hasAnyRole } from "@/hooks/useRoles";
import { ScrollText, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/audit")({
  head: () => ({ meta: [{ title: "Audit Logs — Bungoma CPMS" }] }),
  component: AuditPage,
});

function AuditPage() {
  const { user } = Route.useRouteContext();
  const { data: roles, isLoading } = useRoles(user.id);
  const allowed = hasAnyRole(roles, ["hr", "system_admin", "super_admin"]);
  const [filter, setFilter] = useState("");

  const { data: logs } = useQuery({
    queryKey: ["audit-logs"],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  if (!isLoading && !allowed) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader authenticated userId={user.id} />
        <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <Card className="p-10 text-center">
            <ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground" />
            <h1 className="mt-3 font-display text-2xl font-bold">Authorised viewers only</h1>
          </Card>
        </main>
      </div>
    );
  }

  const filtered = (logs ?? []).filter((l) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (l.action ?? "").toLowerCase().includes(q)
      || (l.actor_email ?? "").toLowerCase().includes(q)
      || (l.entity_type ?? "").toLowerCase().includes(q)
      || (l.entity_id ?? "").toLowerCase().includes(q);
  });

  return (
    <div className="min-h-screen bg-background">
      <AppHeader authenticated userId={user.id} />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-primary">Administration</div>
          <h1 className="mt-2 font-display text-3xl font-bold flex items-center gap-2"><ScrollText className="h-7 w-7 text-primary" /> Audit logs</h1>
          <p className="mt-1 text-sm text-muted-foreground">Last 500 actions across the EPMS. Recorded: role changes, cycle signatures, approvals, password resets, account modifications.</p>
        </div>

        <Card className="mt-6 p-5">
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by action, actor email, entity…" className="max-w-md" />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left uppercase tracking-wider text-muted-foreground">
                <tr><th className="py-2">When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th></tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <tr key={l.id} className="border-t border-border align-top">
                    <td className="py-2 whitespace-nowrap text-muted-foreground">{new Date(l.created_at).toLocaleString()}</td>
                    <td className="py-2">{l.actor_email ?? l.actor_id?.slice(0, 8) ?? "—"}</td>
                    <td className="py-2"><Badge variant="secondary">{l.action}</Badge></td>
                    <td className="py-2">{l.entity_type ?? "—"}<div className="text-[10px] text-muted-foreground">{l.entity_id ?? ""}</div></td>
                    <td className="py-2"><pre className="max-w-xs overflow-hidden text-ellipsis whitespace-pre-wrap text-[10px] text-muted-foreground">{JSON.stringify(l.new_values ?? l.old_values ?? {}, null, 0)}</pre></td>
                  </tr>
                ))}
                {filtered.length === 0 && (<tr><td colSpan={5} className="py-8 text-center text-muted-foreground">No matching entries.</td></tr>)}
              </tbody>
            </table>
          </div>
        </Card>
      </main>
    </div>
  );
}
