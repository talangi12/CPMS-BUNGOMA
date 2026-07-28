import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useRoles, hasAnyRole } from "@/hooks/useRoles";
import { Building2, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/org-structure")({
  head: () => ({ meta: [{ title: "Org Structure — Bungoma CPMS" }] }),
  component: OrgPage,
});

function OrgPage() {
  const { user } = Route.useRouteContext();
  const { data: roles, isLoading } = useRoles(user.id);
  const allowed = hasAnyRole(roles, ["system_admin", "super_admin", "hr"]);
  const [q, setQ] = useState("");

  const { data } = useQuery({
    queryKey: ["org-units"], enabled: allowed,
    queryFn: async () => {
      const { data: units } = await supabase.from("org_units").select("*").order("directorate").order("department");
      return units ?? [];
    },
  });

  const grouped = useMemo(() => {
    const filtered = (data ?? []).filter((u) =>
      !q || [u.directorate, u.department, u.section, u.unit].some((v) => v?.toLowerCase().includes(q.toLowerCase()))
    );
    const map = new Map<string, { directorate: string; departments: Map<string, typeof filtered> }>();
    for (const u of filtered) {
      const dir = u.directorate || "(No directorate)";
      if (!map.has(dir)) map.set(dir, { directorate: dir, departments: new Map() });
      const d = map.get(dir)!;
      if (!d.departments.has(u.department)) d.departments.set(u.department, []);
      d.departments.get(u.department)!.push(u);
    }
    return Array.from(map.values());
  }, [data, q]);

  if (!isLoading && !allowed) {
    return (
      <div className="min-h-screen bg-background"><AppHeader authenticated userId={user.id} />
        <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <Card className="p-10 text-center"><ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground" />
            <h1 className="mt-3 font-display text-2xl font-bold">Admins only</h1>
          </Card>
        </main>
      </div>
    );
  }

  const total = (data ?? []).reduce((s, u) => s + (u.employee_count ?? 0), 0);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader authenticated userId={user.id} />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="text-xs font-semibold uppercase tracking-widest text-primary">Administration</div>
        <h1 className="mt-2 font-display text-3xl font-bold flex items-center gap-2"><Building2 className="h-7 w-7 text-primary" /> Organisational structure</h1>
        <p className="mt-1 text-sm text-muted-foreground">Auto-generated from imported employee records. {data?.length ?? 0} units · {total} employees indexed.</p>

        <Card className="mt-6 p-4">
          <Input placeholder="Filter by directorate, department, section, unit…" value={q} onChange={(e) => setQ(e.target.value)} />
        </Card>

        <div className="mt-6 space-y-4">
          {grouped.map((dir) => (
            <Card key={dir.directorate} className="p-5">
              <h2 className="font-display text-lg font-bold">{dir.directorate}</h2>
              <div className="mt-3 space-y-3">
                {Array.from(dir.departments.entries()).map(([dept, units]) => (
                  <div key={dept} className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between">
                      <div className="font-display text-sm font-bold">{dept}</div>
                      <Badge variant="secondary">{units.reduce((s, u) => s + (u.employee_count ?? 0), 0)} staff</Badge>
                    </div>
                    {units.some((u) => u.section || u.unit) && (
                      <ul className="mt-2 grid gap-1.5 text-xs sm:grid-cols-2">
                        {units.filter((u) => u.section || u.unit).map((u) => (
                          <li key={u.id} className="flex items-center justify-between rounded border border-border bg-muted/30 px-2 py-1.5">
                            <span>{u.section || "—"}{u.unit ? ` › ${u.unit}` : ""}</span>
                            <span className="text-muted-foreground">{u.employee_count}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          ))}
          {grouped.length === 0 && <Card className="p-10 text-center text-sm text-muted-foreground">No units yet. Run an import to populate the structure.</Card>}
        </div>
      </main>
    </div>
  );
}
