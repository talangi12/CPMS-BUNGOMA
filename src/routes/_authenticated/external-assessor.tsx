import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Search, BarChart3, Users, ArrowRight } from "lucide-react";
import { requireRole } from "@/lib/authGuard";
import { getExternalAssessorEmployees, getExternalAssessorSupervisors } from "@/lib/appraisal.functions";

export const Route = createFileRoute("/_authenticated/external-assessor")({
  head: () => ({ meta: [{ title: "External Assessor Portal — Bungoma CPMS" }] }),
  beforeLoad: async () => {
    await requireRole(["external_assessor"]);
    return null;
  },
  component: ExternalAssessorPortal,
});

type SupervisorRow = {
  id: string;
  full_name: string;
  department: string | null;
  designation: string | null;
  employee_count: number;
};

type AppraisalSummary = {
  id: string;
  period: string;
  status: string;
  total_score: number | null;
  rating: string | null;
  supervisor_reviewed_at: string | null;
  updated_at: string | null;
  created_at: string | null;
};

type EmployeeRow = {
  id: string;
  full_name: string;
  department: string | null;
  designation: string | null;
  id_number: string | null;
  personal_number: string | null;
  employment_status: string | null;
  supervisor_id: string | null;
  latestAppraisal: AppraisalSummary | null;
  progressUpdates: number;
};

function ExternalAssessorPortal() {
  const { user } = Route.useRouteContext();
  const [supervisorId, setSupervisorId] = useState<string | null>(null);

  const fetchSupervisors = useServerFn(getExternalAssessorSupervisors);
  const fetchEmployees = useServerFn(getExternalAssessorEmployees);

  const { data: supervisors = [], isLoading: supervisorsLoading } = useQuery<SupervisorRow[]>(
    ["external-assessor-supervisors"],
    async () => fetchSupervisors(),
  );

  const { data: employees = [], isLoading: employeesLoading } = useQuery<EmployeeRow[]>(
    ["external-assessor-employees", supervisorId],
    async () => (supervisorId ? fetchEmployees({ data: { supervisorId } }) : []),
    { enabled: Boolean(supervisorId) },
  );

  useEffect(() => {
    if (!supervisorId && supervisors.length > 0) {
      setSupervisorId(supervisors[0].id);
    }
  }, [supervisorId, supervisors]);

  const selectedSupervisor = supervisors.find((sup) => sup.id === supervisorId);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader authenticated userId={user.id} />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-primary">External Assessor</div>
            <h1 className="mt-2 font-display text-3xl font-bold">County appraisal oversight</h1>
            <p className="mt-1 text-sm text-muted-foreground">Monitor supervisors and their appraisal progress, with quick access to reports and analytics.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/reports"><Button size="sm" variant="outline"><FileText className="mr-2 h-4 w-4" />Reports</Button></Link>
            <Link to="/analytics"><Button size="sm" variant="outline"><BarChart3 className="mr-2 h-4 w-4" />Analytics</Button></Link>
            <Link to="/search"><Button size="sm" variant="outline"><Search className="mr-2 h-4 w-4" />Search</Button></Link>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
          <Card className="space-y-4 p-5">
            <div className="flex items-center gap-3">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Supervisor panel</div>
                <div className="text-lg font-semibold">{supervisors.length} supervisors</div>
              </div>
            </div>
            {supervisorsLoading ? (
              <div className="text-sm text-muted-foreground">Loading supervisors…</div>
            ) : supervisors.length === 0 ? (
              <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">No supervisors are currently registered.</div>
            ) : (
              <div className="space-y-2">
                {supervisors.map((sup) => (
                  <button
                    key={sup.id}
                    type="button"
                    onClick={() => setSupervisorId(sup.id)}
                    className={`w-full rounded-lg border p-4 text-left transition ${sup.id === supervisorId ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-muted/40"}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium">{sup.full_name}</div>
                        <div className="text-xs text-muted-foreground">{sup.department ?? "—"} · {sup.designation ?? "—"}</div>
                      </div>
                      <Badge variant="secondary">{sup.employee_count} employees</Badge>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <div className="space-y-6">
            <Card className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-primary">Team summary</div>
                  <h2 className="mt-2 text-xl font-semibold">{selectedSupervisor ? selectedSupervisor.full_name : "Select a supervisor"}</h2>
                  <p className="text-sm text-muted-foreground">{selectedSupervisor ? `${selectedSupervisor.employee_count} assigned employees` : "Choose a supervisor to inspect appraisal progress."}</p>
                </div>
                {selectedSupervisor ? (
                  <Badge variant="secondary">{selectedSupervisor.department ?? "Unknown department"}</Badge>
                ) : null}
              </div>

              {selectedSupervisor ? (
                employeesLoading ? (
                  <div className="mt-6 text-sm text-muted-foreground">Loading employee progress…</div>
                ) : employees.length === 0 ? (
                  <div className="mt-6 rounded-lg border border-border bg-muted/20 p-6 text-sm text-muted-foreground">No employees found for this supervisor.</div>
                ) : (
                  <div className="mt-6 overflow-hidden rounded-xl border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                        <tr>
                          <th className="px-4 py-3">Employee</th>
                          <th className="px-4 py-3">Appraisal status</th>
                          <th className="px-4 py-3">Score</th>
                          <th className="px-4 py-3">Progress updates</th>
                          <th className="px-4 py-3">Latest review</th>
                        </tr>
                      </thead>
                      <tbody>
                        {employees.map((emp) => (
                          <tr key={emp.id} className="border-t border-border hover:bg-muted/40">
                            <td className="px-4 py-3">
                              <div className="font-medium">{emp.full_name}</div>
                              <div className="text-xs text-muted-foreground">{emp.designation ?? "—"} · {emp.department ?? "—"}</div>
                            </td>
                            <td className="px-4 py-3">{emp.latestAppraisal?.status ?? "No appraisal"}</td>
                            <td className="px-4 py-3">{emp.latestAppraisal?.total_score != null ? `${emp.latestAppraisal.total_score}%` : "—"}</td>
                            <td className="px-4 py-3">{emp.progressUpdates}</td>
                            <td className="px-4 py-3">{emp.latestAppraisal?.supervisor_reviewed_at ? new Date(emp.latestAppraisal.supervisor_reviewed_at).toLocaleDateString() : emp.latestAppraisal ? "Pending" : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : null}
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
