import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, FileText } from "lucide-react";
import { useMemo } from "react";
import { getNationalId } from "@/lib/appraisal-scoring";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Reports — Bungoma CPMS" }] }),
  component: ReportsPage,
});

type Stats = Record<string, unknown> & { scope?: string };

function ReportsPage() {
  const { user } = Route.useRouteContext();

  const { data: stats, isLoading } = useQuery({
    queryKey: ["role-stats", user.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_stats_for_role", { _uid: user.id });
      if (error) throw error;
      return (data ?? null) as Stats | null;
    },
  });

  const { data: rows } = useQuery({
    queryKey: ["reports-rows", user.id, stats?.scope],
    enabled: !!stats?.scope,
    queryFn: async () => {
      const scope = stats?.scope as string;
      if (scope === "self") {
        const { data } = await supabase.from("appraisals")
          .select("id, period, status, total_score, rating, created_at")
          .eq("employee_id", user.id).order("created_at", { ascending: false });
        return data ?? [];
      }
      if (scope === "team") {
        const { data } = await supabase.from("appraisals")
          .select("id, period, status, total_score, rating, created_at, employee_id, profiles!appraisals_employee_id_fkey(full_name, employee_no, id_number, department)")
          .eq("chosen_supervisor_id", user.id).order("created_at", { ascending: false });
        return data ?? [];
      }
      // dept/directorate/county - read profiles to filter
      const { data: me } = await supabase.from("profiles").select("department, directorate").eq("id", user.id).maybeSingle();
      let q = supabase.from("appraisals")
        .select("id, period, status, total_score, rating, created_at, employee_id, profiles!appraisals_employee_id_fkey(full_name, employee_no, id_number, department, directorate)")
        .order("created_at", { ascending: false }).limit(500);
      if (scope === "department" && me?.department && me?.directorate) {
        // filter via FK alias in client side after fetch (PostgREST embed filter limited)
      } else if (scope === "directorate" && me?.department) {
        // same
      }
      const { data } = await q;
      const list = (data ?? []) as Array<Record<string, unknown> & { profiles?: { department?: string | null; directorate?: string | null } | null }>;
      if (scope === "department") {
        return list.filter((r) =>
          (r.profiles?.department ?? "").toLowerCase() === (me?.department ?? "").toLowerCase()
          && (r.profiles?.directorate ?? "").toLowerCase() === (me?.directorate ?? "").toLowerCase());
      }
      if (scope === "directorate") {
        return list.filter((r) =>
          (r.profiles?.department ?? "").toLowerCase() === (me?.department ?? "").toLowerCase());
      }
      return list;
    },
  });

  const scopeTitle = useMemo(() => {
    switch (stats?.scope) {
      case "county": return "County-wide report";
      case "directorate": return "Directorate report";
      case "department": return "Departmental report";
      case "team": return "Team report";
      default: return "My appraisal history";
    }
  }, [stats?.scope]);

  function exportCsv() {
    if (!rows?.length) return;
    const header = ["Period","Employee","National ID","Department","Status","Score","Rating","Created"];
    const lines = [header.join(",")];
    for (const r of rows as Array<Record<string, unknown>>) {
      const prof = (r as { profiles?: { full_name?: string; employee_no?: string; department?: string } }).profiles;
      lines.push([
        r.period, prof?.full_name ?? "(self)", getNationalId(prof as { id_number?: string | null; national_id?: string | null; employee_no?: string | null } | undefined) ?? "-", prof?.department ?? "-",
        r.status, r.total_score ?? "", r.rating ?? "",
        r.created_at ? new Date(r.created_at as string).toISOString().slice(0,10) : "",
      ].map((c) => `"${String(c ?? "").replace(/"/g,'""')}"`).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `epms-report-${stats?.scope ?? "report"}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader authenticated userId={user.id} />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-primary">Reporting</div>
            <h1 className="mt-1 font-display text-3xl font-bold">{scopeTitle}</h1>
            <p className="mt-1 text-sm text-muted-foreground">Visibility is automatically scoped to your role.</p>
          </div>
          <Button variant="outline" onClick={exportCsv} disabled={!rows?.length}>
            <Download className="mr-1.5 h-4 w-4" /> Export CSV
          </Button>
        </div>

        {isLoading ? (
          <div className="mt-8 text-sm text-muted-foreground">Loading…</div>
        ) : (
          <>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {summaryItems(stats).map((s) => (
                <Card key={s.label} className="p-4">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{s.label}</div>
                  <div className="mt-1 font-display text-2xl font-bold">{s.value}</div>
                </Card>
              ))}
            </div>

            <Card className="mt-6 overflow-hidden">
              <div className="border-b border-border px-4 py-3 text-sm font-semibold">
                <FileText className="mr-1.5 inline h-4 w-4" /> Appraisal records ({rows?.length ?? 0})
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left">Period</th>
                      {stats?.scope !== "self" && <th className="px-4 py-2 text-left">Employee</th>}
                      {stats?.scope !== "self" && <th className="px-4 py-2 text-left">National ID</th>}
                      {stats?.scope !== "self" && <th className="px-4 py-2 text-left">Department</th>}
                      <th className="px-4 py-2 text-left">Status</th>
                      <th className="px-4 py-2 text-right">Score</th>
                      <th className="px-4 py-2 text-left">Rating</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(rows ?? []).map((r) => {
                      const prof = (r as { profiles?: { full_name?: string; employee_no?: string; department?: string } }).profiles;
                      return (
                        <tr key={r.id as string} className="border-t border-border">
                          <td className="px-4 py-2">{r.period as string}</td>
                          {stats?.scope !== "self" && <td className="px-4 py-2">{prof?.full_name ?? "—"}</td>}
                          {stats?.scope !== "self" && <td className="px-4 py-2">{getNationalId(prof as { id_number?: string | null; national_id?: string | null; employee_no?: string | null } | undefined) ?? "—"}</td>}
                          {stats?.scope !== "self" && <td className="px-4 py-2">{prof?.department ?? "—"}</td>}
                          <td className="px-4 py-2"><Badge variant="outline">{r.status as string}</Badge></td>
                          <td className="px-4 py-2 text-right">{r.total_score ? Number(r.total_score).toFixed(1) : "—"}</td>
                          <td className="px-4 py-2">{(r.rating as string) ?? "—"}</td>
                        </tr>
                      );
                    })}
                    {(!rows || rows.length === 0) && (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No records visible at your access level.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

          </>
        )}
      </main>
    </div>
  );
}

function summaryItems(s: Stats | null | undefined): Array<{ label: string; value: string }> {
  if (!s) return [];
  const n = (v: unknown) => String(typeof v === "number" ? v : Number(v ?? 0));
  if (s.scope === "self") {
    return [
      { label: "Total", value: n(s.total) },
      { label: "Submitted", value: n(s.submitted) },
      { label: "Approved", value: n(s.approved) },
      { label: "County completion", value: `${n(s.county_completion_pct)}%` },
    ];
  }
  if (s.scope === "team") {
    return [
      { label: "Team total", value: n(s.total) },
      { label: "Pending review", value: n(s.pending) },
      { label: "Approved", value: n(s.approved) },
    ];
  }
  return [
    { label: "Total appraisals", value: n(s.total) },
    { label: "Approved", value: n(s.approved) },
    { label: "Completion", value: `${n(s.completion_pct)}%` },
  ];
}
