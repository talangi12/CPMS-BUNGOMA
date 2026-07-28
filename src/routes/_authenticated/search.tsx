import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useRoles, hasAnyRole } from "@/hooks/useRoles";
import { Search as SearchIcon, ShieldCheck } from "lucide-react";
import { searchEmployees } from "@/lib/search.functions";

export const Route = createFileRoute("/_authenticated/search")({
  head: () => ({ meta: [{ title: "Employee Search — Bungoma CPMS" }] }),
  component: SearchPage,
});

type Row = {
  id: string;
  full_name: string;
  id_number: string | null;
  personal_number: string | null;
  department: string | null;
  directorate: string | null;
  job_group: string | null;
  designation: string | null;
  employment_status: string | null;
  gender: string | null;
  disability_status: string | null;
  work_station: string | null;
  supervisor_id: string | null;
};

function SearchPage() {
  const { user } = Route.useRouteContext();
  const { data: roles, isLoading } = useRoles(user.id);
  const allowed = hasAnyRole(roles, ["governor", "cec", "chief_officer", "director", "supervisor", "system_admin", "super_admin", "hr"]);
  const searchFn = useServerFn(searchEmployees);

  const [mode, setMode] = useState<"id_number" | "personal_number">("id_number");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Row[] | null>(null);

  async function go(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await searchFn({ data: { query: query.trim(), mode } });
      setResults(res as Row[]);
    } finally { setBusy(false); }
  }

  if (!isLoading && !allowed) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader authenticated userId={user.id} />
        <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <Card className="p-10 text-center">
            <ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground" />
            <h1 className="mt-3 font-display text-2xl font-bold">Authorised officers only</h1>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader authenticated userId={user.id} />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-primary">Directory</div>
          <h1 className="mt-2 font-display text-3xl font-bold flex items-center gap-2"><SearchIcon className="h-7 w-7 text-primary" /> Employee search</h1>
          <p className="mt-1 text-sm text-muted-foreground">Search by ID Number or Personal Number. Results are scoped by your departmental authority.</p>
        </div>

        <Card className="mt-6 p-5">
          <form onSubmit={go} className="grid gap-3 sm:grid-cols-[1fr_220px_auto]">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Enter ID or Personal Number" />
            <select className="rounded-md border border-input bg-background px-3 py-2 text-sm" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="id_number">By ID Number</option>
              <option value="personal_number">By Personal Number</option>
            </select>
            <Button type="submit" disabled={busy || !query.trim()}>{busy ? "Searching…" : "Search"}</Button>
          </form>
        </Card>

        {results && (
          <Card className="mt-6 p-5">
            {results.length === 0 ? (
              <p className="text-sm text-muted-foreground">No matching record within your authority.</p>
            ) : (
              <div className="space-y-3">
                {results.map((r) => (
                  <div key={r.id} className="rounded-lg border border-border p-4">
                    <div className="flex items-center justify-between">
                      <div className="font-display text-lg font-bold">{r.full_name}</div>
                      <Badge variant="secondary">{r.employment_status ?? "Active"}</Badge>
                    </div>
                    <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
                      <Field label="ID Number" value={r.id_number} />
                      <Field label="Department" value={r.department} />
                      <Field label="Directorate" value={r.directorate} />
                      <Field label="Job Group" value={r.job_group} />
                      <Field label="Designation" value={r.designation} />
                      <Field label="Workstation" value={r.work_station} />
                      <Field label="Gender" value={r.gender} />
                      <Field label="Disability" value={r.disability_status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </main>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-medium">{value ?? "—"}</div>
    </div>
  );
}
