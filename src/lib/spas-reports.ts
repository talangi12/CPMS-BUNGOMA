import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "@/integrations/supabase/client";
import { getNationalId } from "@/lib/appraisal-scoring";

export type ReportKind = "form2_quarterly" | "form3_departmental" | "form4_cipmc" | "form5_workplan" | "annual_summary";

const KIND_LABEL: Record<ReportKind, string> = {
  form2_quarterly: "Employee Quarterly Performance Report (CGB/SPA Form 2)",
  form3_departmental: "Departmental Summary of SPAS Reports (CGB/SPA Form 3)",
  form4_cipmc: "CIPMC Recommendation Report to CEC (CGB/SPA Form 4)",
  form5_workplan: "Individual Work Plan (CGB/SPA Form 5)",
  annual_summary: "Annual Performance Summary",
};

type LastAT = { lastAutoTable: { finalY: number } };

export async function reserveReportNumber(kind: ReportKind, extra: {
  employeeId?: string | null;
  appraisalId?: string | null;
  workplanId?: string | null;
  cycleId?: string | null;
  department?: string | null;
  directorate?: string | null;
  fiscalYear?: string | null;
  quarter?: number | null;
  generatedBy: string;
}) {
  const { data: numRaw, error: numErr } = await supabase.rpc("next_report_number", {
    _type: kind,
    _quarter: extra.quarter ?? undefined,
  });
  if (numErr) throw numErr;
  const number = String(numRaw);
  const { error } = await supabase.from("report_registry").insert({
    report_number: number,
    report_type: kind,
    related_employee_id: extra.employeeId ?? null,
    related_appraisal_id: extra.appraisalId ?? null,
    related_workplan_id: extra.workplanId ?? null,
    cycle_id: extra.cycleId ?? null,
    department: extra.department ?? null,
    directorate: extra.directorate ?? null,
    fiscal_year: extra.fiscalYear ?? null,
    quarter: extra.quarter ?? null,
    generated_by: extra.generatedBy,
    metadata: { title: KIND_LABEL[kind] },
  });
  if (error) throw error;
  return number;
}

export function recommendationFromScore(score: number | null | undefined): { label: string; band: string } {
  const s = Number(score ?? 0);
  if (s >= 90) return { label: "Outstanding – Eligible for Recognition", band: "outstanding" };
  if (s >= 80) return { label: "Very Good", band: "very_good" };
  if (s >= 70) return { label: "Good", band: "good" };
  if (s >= 60) return { label: "Fair – Improvement Required", band: "fair" };
  return { label: "Unsatisfactory – Consider Corrective Action", band: "unsatisfactory" };
}

function header(doc: jsPDF, title: string, subtitle: string, number: string) {
  doc.setFontSize(11); doc.setFont("helvetica", "bold");
  doc.text("COUNTY GOVERNMENT OF BUNGOMA", 105, 15, { align: "center" });
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text("Staff Performance Appraisal System (SPAS)", 105, 21, { align: "center" });
  doc.setFontSize(12); doc.setFont("helvetica", "bold");
  doc.text(title, 105, 30, { align: "center" });
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text(subtitle, 105, 36, { align: "center" });
  doc.setFontSize(8);
  doc.text(`Report No: ${number}`, 200, 15, { align: "right" });
  doc.text(`Generated: ${new Date().toLocaleString()}`, 200, 20, { align: "right" });
  doc.setLineWidth(0.3); doc.line(14, 40, 200, 40);
}

function signoffBlock(doc: jsPDF, startY: number, roles: string[]) {
  let y = startY;
  doc.setFontSize(10); doc.setFont("helvetica", "bold");
  doc.text("Official Sign-Off", 14, y); y += 6;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  for (const role of roles) {
    doc.text(`${role}:`, 14, y);
    doc.text("Name: ______________________________", 55, y);
    doc.text("Signature: ________________________", 130, y);
    y += 6;
    doc.text("Date/Time: __________________________", 55, y);
    y += 8;
  }
  return y;
}

export async function generateForm2Quarterly(appraisalId: string, generatedBy: string): Promise<{ number: string; blob: Blob }> {
  const { data: a, error } = await supabase.from("appraisals")
    .select("*, profiles!appraisals_employee_id_fkey(full_name, employee_no, designation, department, directorate)")
    .eq("id", appraisalId).single();
  if (error) throw error;
  const emp = (a.profiles ?? {}) as { full_name?: string; employee_no?: string; designation?: string; department?: string; directorate?: string };
  const period = String(a.period ?? "");

  const { data: targets } = await supabase.from("targets").select("*").eq("appraisal_id", appraisalId).order("sort_order");

  const number = await reserveReportNumber("form2_quarterly", {
    employeeId: a.employee_id as string, appraisalId, generatedBy, department: emp.department, directorate: emp.directorate, fiscalYear: (a.fy_start as string | null) ?? undefined,
  });

  const doc = new jsPDF();
  header(doc, "EMPLOYEE QUARTERLY PERFORMANCE REPORT", "CGB/SPA Form 2", number);
  autoTable(doc, {
    startY: 44, theme: "grid", styles: { fontSize: 9 },
    body: [
      ["Performance Period", period, "Reporting Date", new Date().toLocaleDateString()],
      ["Directorate", emp.directorate ?? "—", "Department", emp.department ?? "—"],
      ["Employee Name", emp.full_name ?? "—", "National ID", getNationalId(emp as { id_number?: string | null; national_id?: string | null; employee_no?: string | null } | null) ?? "—"],
      ["Designation", emp.designation ?? "—", "Overall Score", a.total_score ? `${Number(a.total_score).toFixed(1)}%` : "—"],
    ],
  });

  autoTable(doc, {
    startY: (doc as unknown as LastAT).lastAutoTable.finalY + 4,
    head: [["#", "Agreed Target", "Indicator", "Achievement", "Score"]],
    body: (targets ?? []).map((t, i) => [
      String(i + 1),
      String(t.target ?? "—"),
      String(t.indicator ?? "—"),
      String(t.achieved_result ?? t.endyear_actual ?? t.midyear_progress ?? "—"),
      t.endyear_supervisor_score ?? t.midyear_score ?? t.score ?? "—",
    ]),
    styles: { fontSize: 8 },
  });

  const { data: adds } = await supabase.from("additional_assignments")
    .select("*").eq("employee_id", a.employee_id as string).eq("status", "completed");
  if (adds && adds.length) {
    autoTable(doc, {
      startY: (doc as unknown as LastAT).lastAutoTable.finalY + 4,
      head: [["Additional Assignment", "Description", "Assigned", "Completed", "Achievement"]],
      body: adds.map((x) => [
        String(x.title ?? "—"), String(x.description ?? "—"),
        x.date_assigned ? new Date(x.date_assigned as string).toLocaleDateString() : "—",
        x.completed_at ? new Date(x.completed_at as string).toLocaleDateString() : "—",
        String(x.achievement_summary ?? "—"),
      ]),
      styles: { fontSize: 8 },
    });
  }

  const y = (doc as unknown as LastAT).lastAutoTable.finalY + 8;
  signoffBlock(doc, y, ["Employee", "Supervisor"]);

  return { number, blob: doc.output("blob") };
}

export async function generateForm3Departmental(department: string, period: string, generatedBy: string) {
  const { data } = await supabase.from("appraisals")
    .select("id, total_score, rating, status, employee_id, profiles!appraisals_employee_id_fkey(full_name, employee_no, designation, department, directorate)")
    .eq("period", period).in("status", ["approved", "acknowledged"]).limit(1000);
  const rows = ((data ?? []) as unknown as Array<Record<string, unknown> & { profiles?: Record<string, unknown> | null }>)
    .filter((r) => String(r.profiles?.department ?? "").toLowerCase() === department.toLowerCase());

  const number = await reserveReportNumber("form3_departmental", { department, generatedBy });

  const doc = new jsPDF("landscape");
  header(doc, "DEPARTMENTAL SUMMARY OF SPAS REPORTS", `CGB/SPA Form 3 — ${department} — ${period}`, number);
  autoTable(doc, {
    startY: 44,
    head: [["#", "National ID", "Employee Name", "Designation", "Final Rating (%)", "Rating"]],
    body: rows.map((r, i) => [
      String(i + 1),
      String(getNationalId((r.profiles ?? null) as { id_number?: string | null; national_id?: string | null; employee_no?: string | null }) ?? "—"),
      String((r.profiles?.full_name as string) ?? "—"),
      String((r.profiles?.designation as string) ?? "—"),
      r.total_score ? Number(r.total_score).toFixed(1) : "—",
      String(r.rating ?? "—"),
    ]),
    styles: { fontSize: 8 },
  });
  const y = (doc as unknown as LastAT).lastAutoTable.finalY + 10;
  doc.setFontSize(10); doc.setFont("helvetica", "bold");
  doc.text("Director's Remarks:", 14, y);
  doc.rect(14, y + 2, 260, 20);
  signoffBlock(doc, y + 28, ["Director", "Chief Officer"]);
  return { number, blob: doc.output("blob"), count: rows.length };
}

export async function generateForm4CIPMC(period: string, generatedBy: string) {
  const { data } = await supabase.from("appraisals")
    .select("id, total_score, rating, status, employee_id, profiles!appraisals_employee_id_fkey(full_name, employee_no, designation, department, directorate)")
    .eq("period", period).in("status", ["approved", "acknowledged"]).limit(2000);
  const rows = ((data ?? []) as unknown as Array<Record<string, unknown> & { profiles?: Record<string, unknown> | null }>);

  const rewards = rows.filter((r) => Number(r.total_score ?? 0) >= 80).length;
  const sanctions = rows.filter((r) => Number(r.total_score ?? 0) < 60).length;
  const { count: totalStaff } = await supabase.from("profiles").select("id", { count: "exact", head: true });

  const number = await reserveReportNumber("form4_cipmc", { generatedBy });

  const doc = new jsPDF("landscape");
  header(doc, "RECOMMENDATION REPORT TO CEC (CIPMC)", `CGB/SPA Form 4 — ${period}`, number);
  autoTable(doc, {
    startY: 44, theme: "grid", styles: { fontSize: 9 },
    body: [
      ["Total Staff", String(totalStaff ?? 0), "Officers Appraised", String(rows.length)],
      ["Recommended for Rewards", String(rewards), "Recommended for Sanctions", String(sanctions)],
    ],
  });
  autoTable(doc, {
    startY: (doc as unknown as LastAT).lastAutoTable.finalY + 4,
    head: [["#", "Employee", "National ID", "Designation", "Directorate", "Score %", "Recommendation"]],
    body: rows.map((r, i) => {
      const rec = recommendationFromScore(r.total_score as number | null);
      return [
        String(i + 1),
        String((r.profiles?.full_name as string) ?? "—"),
        String(getNationalId((r.profiles ?? null) as { id_number?: string | null; national_id?: string | null; employee_no?: string | null } | null) ?? "—"),
        String((r.profiles?.designation as string) ?? "—"),
        String((r.profiles?.directorate as string) ?? "—"),
        r.total_score ? Number(r.total_score).toFixed(1) : "—",
        rec.label,
      ];
    }),
    styles: { fontSize: 7 },
  });
  const y = (doc as unknown as LastAT).lastAutoTable.finalY + 10;
  signoffBlock(doc, y, ["CIPMC Chairperson", "Chief Officer", "County Executive Committee Member"]);
  return { number, blob: doc.output("blob"), rewards, sanctions, count: rows.length };
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
