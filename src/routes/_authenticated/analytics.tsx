import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line, Legend, Cell } from "recharts";
import { Download, FileSpreadsheet, FileText, Printer, TrendingUp, Users, ClipboardCheck, Clock, CheckCircle2 } from "lucide-react";
import jsPDF from "jspdf";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/_authenticated/analytics")({
  head: () => ({ meta: [{ title: "Departmental Analytics — Bungoma CPMS" }] }),
  component: AnalyticsPage,
  errorComponent: ({ error }) => <div className="p-8 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-8">Not found.</div>,
});

type DeptRow = {
  department: string;
  directorate: string | null;
  employees: number;
  submitted: number;
  approved: number;
  pending: number;
  escalated: number;
  completion_pct: number;
};
type ProgressData = {
  scope: string;
  rows: DeptRow[];
  totals: { employees: number; submitted: number; approved: number; pending: number; escalated: number };
  completion_pct: number;
};
type CycleRow = { id: string; name: string };
type HistoryRow = { cycle_id: string; cycle: string; fy_start: string; submitted: number; approved: number; total: number; completion_pct: number };

function colorFor(pct: number) {
  if (pct >= 90) return "hsl(142 70% 40%)"; // green
  if (pct >= 70) return "hsl(45 95% 50%)"; // yellow
  return "hsl(0 75% 55%)"; // red
}

function AnalyticsPage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const router = useRouter();
  const [cycleId, setCycleId] = useState<string>("all");
  const [deptFilter, setDeptFilter] = useState("");
  const [dirFilter, setDirFilter] = useState<string>("all");

  // realtime → refresh
  useEffect(() => {
    const ch = supabase
      .channel(`analytics-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "appraisals" }, () => {
        qc.invalidateQueries({ queryKey: ["dept-progress", user.id] });
        qc.invalidateQueries({ queryKey: ["dept-history", user.id] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user.id, qc]);

  const { data: cycles } = useQuery({
    queryKey: ["cycles-list"],
    queryFn: async () => {
      const { data } = await supabase.from("appraisal_cycles").select("id, fy_label").order("fy_start", { ascending: false });
      return ((data ?? []) as Array<{ id: string; fy_label: string }>).map((c) => ({ id: c.id, name: c.fy_label }));
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["dept-progress", user.id, cycleId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("department_progress_for_role", {
        _uid: user.id,
        _cycle_id: cycleId === "all" ? undefined : cycleId,
      });
      if (error) throw error;
      return data as unknown as ProgressData;
    },
  });

  const { data: history } = useQuery({
    queryKey: ["dept-history", user.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("department_progress_history", { _uid: user.id });
      if (error) throw error;
      return (data ?? []) as unknown as HistoryRow[];
    },
  });

  type TopPerformer = { employee_id: string; full_name: string; employee_number: string | null; department: string | null; supervisor: string | null; score: number; completion_pct: number; dept_rank: number; county_rank: number };
  const { data: topPerformers } = useQuery({
    queryKey: ["top-performers", user.id, cycleId, dirFilter, deptFilter],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("top_performers_for_role", {
        _uid: user.id,
        _cycle_id: cycleId === "all" ? undefined : cycleId,
        _department: deptFilter || undefined,
      });
      if (error) return [] as TopPerformer[];
      return (data ?? []) as unknown as TopPerformer[];
    },
  });
  const [perfSort, setPerfSort] = useState<"score" | "completion">("score");
  const sortedPerformers = useMemo(() => {
    const list = [...(topPerformers ?? [])];
    list.sort((a, b) => perfSort === "score" ? b.score - a.score : b.completion_pct - a.completion_pct);
    return list.slice(0, 25);
  }, [topPerformers, perfSort]);

  function exportTopPerformersExcel() {
    const ws = XLSX.utils.json_to_sheet(sortedPerformers);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "TopPerformers");
    XLSX.writeFile(wb, "top-performers.xlsx");
  }
  function exportTopPerformersPdf() {
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14);
    doc.text("Bungoma CPMS — Top Performing Appraisees", 14, 14);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 20);
    const headers = ["#", "Name", "Emp No", "Department", "Supervisor", "Score", "Completion", "Dept Rank", "County Rank"];
    const colX = [14, 22, 80, 110, 150, 190, 215, 240, 265];
    doc.setFont("helvetica", "bold");
    headers.forEach((h, i) => doc.text(h, colX[i], 30));
    doc.setFont("helvetica", "normal");
    sortedPerformers.forEach((p, idx) => {
      const y = 36 + idx * 6;
      if (y > 200) return;
      const cells = [String(idx + 1), p.full_name, p.employee_number ?? "—", p.department ?? "—", p.supervisor ?? "—", String(p.score), `${p.completion_pct}%`, `#${p.dept_rank}`, `#${p.county_rank}`];
      cells.forEach((c, i) => doc.text(String(c).slice(0, 24), colX[i], y));
    });
    doc.save("top-performers.pdf");
  }

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const directorates = useMemo(() => Array.from(new Set(rows.map((r) => r.directorate).filter(Boolean))) as string[], [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (dirFilter !== "all" && (r.directorate ?? "") !== dirFilter) return false;
      if (deptFilter && !r.department.toLowerCase().includes(deptFilter.toLowerCase())) return false;
      return true;
    });
  }, [rows, dirFilter, deptFilter]);

  const ranked = useMemo(() => [...filtered].sort((a, b) => b.completion_pct - a.completion_pct), [filtered]);
  const top = ranked.slice(0, 5);
  const bottom = [...ranked].reverse().slice(0, 5);

  function exportExcel() {
    const ws = XLSX.utils.json_to_sheet(filtered);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Departments");
    XLSX.writeFile(wb, "departmental-progress.xlsx");
  }

  function exportPdf() {
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14);
    doc.text("Bungoma CPMS — Departmental Appraisal Progress", 14, 14);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 20);
    doc.text(`Scope: ${data?.scope ?? "—"}  ·  Overall completion: ${data?.completion_pct ?? 0}%`, 14, 26);
    const header = ["Department", "Directorate", "Employees", "Submitted", "Pending", "Approved", "Escalated", "Completion %"];
    const colX = [14, 70, 120, 150, 180, 210, 240, 270];
    doc.setFont("helvetica", "bold");
    header.forEach((h, i) => doc.text(h, colX[i], 36));
    doc.setFont("helvetica", "normal");
    filtered.forEach((r, idx) => {
      const y = 42 + idx * 6;
      if (y > 200) return;
      const cells = [r.department, r.directorate ?? "—", String(r.employees), String(r.submitted), String(r.pending), String(r.approved), `${r.completion_pct}%`];
      cells.forEach((c, i) => doc.text(String(c).slice(0, 28), colX[i], y));
    });
    doc.save("departmental-progress.pdf");
  }

  function printChart() { window.print(); }

  const totals = data?.totals ?? { employees: 0, submitted: 0, approved: 0, pending: 0, escalated: 0 };
  const overall = data?.completion_pct ?? 0;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader authenticated userId={user.id} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-primary">Analytics</div>
            <h1 className="font-display text-3xl font-bold">Departmental Appraisal Progress</h1>
            <p className="text-sm text-muted-foreground">Live ranking and completion across departments — scope: <b>{data?.scope ?? "—"}</b></p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={exportExcel}><FileSpreadsheet className="mr-1.5 h-4 w-4" /> Excel</Button>
            <Button size="sm" variant="outline" onClick={exportPdf}><FileText className="mr-1.5 h-4 w-4" /> PDF</Button>
            <Button size="sm" variant="outline" onClick={printChart}><Printer className="mr-1.5 h-4 w-4" /> Print</Button>
            <Button size="sm" variant="ghost" onClick={() => router.invalidate()}><Download className="mr-1.5 h-4 w-4" /> Refresh</Button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard icon={<Users className="h-4 w-4" />} label="Employees" value={totals.employees} />
          <StatCard icon={<ClipboardCheck className="h-4 w-4" />} label="Submitted" value={totals.submitted} />
          <StatCard icon={<Clock className="h-4 w-4" />} label="Pending" value={totals.pending} accent="text-amber-600" />
          <StatCard icon={<CheckCircle2 className="h-4 w-4" />} label="Approved" value={totals.approved} accent="text-emerald-600" />
          <StatCard icon={<TrendingUp className="h-4 w-4" />} label="Completion" value={`${overall}%`} accent="text-primary" />
        </div>

        {/* Filters */}
        <Card className="mt-6 p-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <label className="text-xs font-medium uppercase text-muted-foreground">Search department</label>
              <Input value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} placeholder="e.g. Health" />
            </div>
            <div>
              <label className="text-xs font-medium uppercase text-muted-foreground">Directorate</label>
              <Select value={dirFilter} onValueChange={setDirFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All directorates</SelectItem>
                  {directorates.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium uppercase text-muted-foreground">Appraisal cycle</label>
              <Select value={cycleId} onValueChange={setCycleId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All cycles</SelectItem>
                  {(cycles ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end text-xs text-muted-foreground">
              Showing <b className="mx-1">{filtered.length}</b> of {rows.length} departments
            </div>
          </div>
        </Card>

        {/* Bar chart */}
        <Card className="mt-6 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">Completion % by department</h2>
            <div className="flex items-center gap-3 text-[11px]">
              <Legend2 color="hsl(142 70% 40%)" label="≥ 90%" />
              <Legend2 color="hsl(45 95% 50%)" label="70–89%" />
              <Legend2 color="hsl(0 75% 55%)" label="< 70%" />
            </div>
          </div>
          {isLoading ? (
            <div className="py-10 text-center text-muted-foreground">Loading…</div>
          ) : ranked.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">No data available for this scope.</div>
          ) : (
            <div className="h-[380px] w-full">
              <ResponsiveContainer>
                <BarChart data={ranked} margin={{ top: 10, right: 20, bottom: 60, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis dataKey="department" angle={-30} textAnchor="end" interval={0} height={70} />
                  <YAxis domain={[0, 100]} unit="%" />
                  <Tooltip formatter={(v: number, _n, p) => [`${v}%`, `Completion (${p.payload.submitted}/${p.payload.employees})`]} />
                  <Bar dataKey="completion_pct" radius={[6, 6, 0, 0]}>
                    {ranked.map((r) => <Cell key={r.department} fill={colorFor(r.completion_pct)} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* Rankings */}
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <h3 className="font-display text-base font-semibold">Top performing departments</h3>
            <ul className="mt-2 space-y-1">
              {top.map((r, i) => (
                <li key={r.department} className="flex items-center justify-between rounded-md bg-emerald-500/5 px-3 py-2 text-sm">
                  <span><span className="mr-2 font-semibold">{i + 1}.</span>{r.department}</span>
                  <span className="font-semibold text-emerald-700">{r.completion_pct}%</span>
                </li>
              ))}
              {top.length === 0 && <li className="text-sm text-muted-foreground">No data.</li>}
            </ul>
          </Card>
          <Card className="p-4">
            <h3 className="font-display text-base font-semibold">Departments requiring attention</h3>
            <ul className="mt-2 space-y-1">
              {bottom.map((r, i) => (
                <li key={r.department} className="flex items-center justify-between rounded-md bg-destructive/5 px-3 py-2 text-sm">
                  <span><span className="mr-2 font-semibold">{i + 1}.</span>{r.department}</span>
                  <span className="font-semibold text-destructive">{r.completion_pct}%</span>
                </li>
              ))}
              {bottom.length === 0 && <li className="text-sm text-muted-foreground">No data.</li>}
            </ul>
          </Card>
        </div>

        {/* Top performing appraisees */}
        <Card className="mt-6 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-base font-semibold">Top performing appraisees</h3>
            <div className="flex items-center gap-2">
              <Select value={perfSort} onValueChange={(v) => setPerfSort(v as "score" | "completion")}>
                <SelectTrigger className="h-8 w-[170px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="score">Sort by score</SelectItem>
                  <SelectItem value="completion">Sort by completion %</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={exportTopPerformersExcel}><FileSpreadsheet className="mr-1.5 h-4 w-4" /> Excel</Button>
              <Button size="sm" variant="outline" onClick={exportTopPerformersPdf}><FileText className="mr-1.5 h-4 w-4" /> PDF</Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Employee</th>
                  <th className="px-3 py-2">Emp No</th>
                  <th className="px-3 py-2">Department</th>
                  <th className="px-3 py-2">Supervisor</th>
                  <th className="px-3 py-2 text-right">Score</th>
                  <th className="px-3 py-2 text-right">Completion</th>
                  <th className="px-3 py-2 text-right">Dept rank</th>
                  <th className="px-3 py-2 text-right">County rank</th>
                </tr>
              </thead>
              <tbody>
                {sortedPerformers.map((p, i) => (
                  <tr key={p.employee_id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-2 font-semibold">{i + 1}</td>
                    <td className="px-3 py-2 font-medium">{p.full_name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{p.employee_number ?? "—"}</td>
                    <td className="px-3 py-2">{p.department ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{p.supervisor ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{p.score}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.completion_pct}%</td>
                    <td className="px-3 py-2 text-right">#{p.dept_rank}</td>
                    <td className="px-3 py-2 text-right">#{p.county_rank}</td>
                  </tr>
                ))}
                {sortedPerformers.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">No performer data available yet for this scope.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>


        {/* Trend */}
        <Card className="mt-6 p-4">
          <h3 className="font-display text-base font-semibold">Historical trend — completion % by cycle</h3>
          {(history?.length ?? 0) === 0 ? (
            <div className="py-10 text-center text-muted-foreground">No prior cycles to compare yet.</div>
          ) : (
            <div className="h-[280px] w-full">
              <ResponsiveContainer>
                <LineChart data={history}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis dataKey="cycle" />
                  <YAxis domain={[0, 100]} unit="%" />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="completion_pct" name="Completion %" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* Table */}
        <Card className="mt-6 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Department</th>
                  <th className="px-3 py-2">Directorate</th>
                  <th className="px-3 py-2 text-right">Employees</th>
                  <th className="px-3 py-2 text-right">Submitted</th>
                  <th className="px-3 py-2 text-right">Pending</th>
                  <th className="px-3 py-2 text-right">Approved</th>
                  
                  <th className="px-3 py-2 text-right">Completion</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.department} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{r.department}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.directorate ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.employees}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.submitted}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.pending}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.approved}</td>
                    
                    <td className="px-3 py-2 text-right">
                      <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: colorFor(r.completion_pct) + "22", color: colorFor(r.completion_pct) }}>
                        {r.completion_pct}%
                      </span>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No matching rows.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </main>
    </div>
  );
}

function StatCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string | number; accent?: string }) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}{label}
      </div>
      <div className={`mt-1 font-display text-xl font-bold ${accent ?? ""}`}>{value}</div>
    </Card>
  );
}

function Legend2({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}
