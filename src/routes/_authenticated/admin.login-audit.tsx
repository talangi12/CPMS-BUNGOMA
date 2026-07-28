import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useRoles, hasAnyRole } from "@/hooks/useRoles";
import { KeyRound, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/login-audit")({
  head: () => ({ meta: [{ title: "Login Audit — Bungoma CPMS" }] }),
  component: LoginAuditPage,
});

function LoginAuditPage() {
  const { user } = Route.useRouteContext();
  const { data: roles, isLoading } = useRoles(user.id);
  const allowed = hasAnyRole(roles, ["hr", "system_admin", "super_admin"]);
  const [filter, setFilter] = useState("");

  const { data: events } = useQuery({
    queryKey: ["login-events"],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("login_events")
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

  const filtered = (events ?? []).filter((e) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (e.id_number ?? "").toLowerCase().includes(q)
      || (e.email ?? "").toLowerCase().includes(q)
      || (e.failure_reason ?? "").toLowerCase().includes(q);
  });

  return (
    <div className="min-h-screen bg-background">
      <AppHeader authenticated userId={user.id} />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-center gap-3">
          <KeyRound className="h-6 w-6 text-primary" />
          <div>
            <h1 className="font-display text-3xl font-bold">Login Audit</h1>
            <p className="text-sm text-muted-foreground">All sign-in attempts across the system.</p>
          </div>
        </div>

        <Card className="mb-4 p-4">
          <Input placeholder="Filter by ID number, email or reason…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </Card>

        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">ID Number</th>
                <th className="px-3 py-2">Outcome</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2">User-Agent</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-t border-border/60">
                  <td className="px-3 py-2 whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td>
                  <td className="px-3 py-2">{e.id_number ?? "—"}</td>
                  <td className="px-3 py-2">
                    {e.success
                      ? <Badge className="bg-primary/15 text-primary">Success</Badge>
                      : <Badge variant="destructive">Failed</Badge>}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{e.failure_reason ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground truncate max-w-[20rem]">{e.user_agent ?? "—"}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">No login events.</td></tr>
              )}
            </tbody>
          </table>
        </Card>
      </main>
    </div>
  );
}
