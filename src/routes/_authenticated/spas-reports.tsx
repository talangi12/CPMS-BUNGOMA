import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { FileText, Download } from "lucide-react";
import { generateForm2Quarterly, generateForm3Departmental, generateForm4CIPMC, saveBlob } from "@/lib/spas-reports";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/_authenticated/spas-reports")({
  head: () => ({ meta: [{ title: "SPAS Reports — Bungoma CPMS" }] }),
  component: Page,
});

function Page() {
  const { user } = Route.useRouteContext();
  const [period, setPeriod] = useState(new Date().getFullYear().toString());
  const [department, setDepartment] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [contractId, setContractId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const { data: archive } = useQuery({
    queryKey: ["report-registry"],
    queryFn: async () => {
      const { data } = await supabase.from("report_registry").select("*").order("generated_at", { ascending: false }).limit(100);
      return data ?? [];
    },
  });

  const { data: departments } = useQuery({
    queryKey: ["report-departments"],
    queryFn: async () => {
      const { data } = await supabase.from("org_units").select("department").neq("department", "").order("department");
      const list = (data ?? []).map((row) => String((row as { department?: string }).department ?? "").trim()).filter((name) => name.length > 0);
      return Array.from(new Set(list)).sort((a, b) => a.localeCompare(b)).map((name) => ({ name }));
    },
  });

  async function resolveAppraisalIdForNationalId(nationalId: string) {
    const lookup = nationalId.trim();
    if (!lookup) throw new Error("Enter a National ID");

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .or(`id_number.eq.${lookup},national_id.eq.${lookup},employee_no.eq.${lookup}`)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile?.id) throw new Error("No employee found for that National ID");

    const { data: appraisal, error: appraisalError } = await supabase
      .from("appraisals")
      .select("id")
      .eq("employee_id", profile.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (appraisalError) throw appraisalError;
    if (!appraisal?.id) throw new Error("No appraisal found for that employee");

    return appraisal.id;
  }

  async function run(kind: "form2" | "form3" | "form4") {
    setBusy(kind);
    try {
      if (kind === "form2") {
        const appraisalId = await resolveAppraisalIdForNationalId(nationalId);
        const { number, blob } = await generateForm2Quarterly(appraisalId, user.id);
        saveBlob(blob, `${number.replaceAll("/", "_")}.pdf`);
      } else if (kind === "form3") {
        if (!department) throw new Error("Enter a department");
        const { number, blob } = await generateForm3Departmental(department, period, user.id);
        saveBlob(blob, `${number.replaceAll("/", "_")}.pdf`);
      } else {
        const { number, blob } = await generateForm4CIPMC(period, user.id);
        saveBlob(blob, `${number.replaceAll("/", "_")}.pdf`);
      }
      toast.success("Report generated & archived");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(null); }
  }

  async function runContractReport(fmt: "pdf" | "excel") {
    if (!contractId.trim()) { toast.error("Enter a contract ID"); return; }
    setBusy("contract-" + fmt);
    try {
      await generateContractReport(contractId.trim(), user.id, fmt);
      toast.success("Performance Contract Report generated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(null); }
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader authenticated userId={user.id} />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="text-xs font-semibold uppercase tracking-widest text-primary">Official SPAS Reports</div>
        <h1 className="mt-1 font-display text-3xl font-bold">Generate SPAS forms</h1>
        <p className="mt-1 text-sm text-muted-foreground">All generated reports receive an auto-numbered ID (CGB/SPAS/YYYY/QN/NNNNNN) and are archived below.</p>

        <div className="mt-6 grid gap-4 lg:grid-cols-4">
          <Card className="p-5">
            <div className="text-xs uppercase text-muted-foreground">CGB/SPA Form 2</div>
            <div className="font-display text-lg font-bold">Employee Quarterly Report</div>
            <Label className="mt-3 block text-xs">National ID</Label>
            <Input value={nationalId} onChange={(e) => setNationalId(e.target.value)} placeholder="e.g. 12345678" />
            <Button className="mt-3 w-full" disabled={busy === "form2"} onClick={() => run("form2")}><FileText className="mr-1.5 h-4 w-4" />Generate</Button>
          </Card>

          <Card className="p-5">
            <div className="text-xs uppercase text-muted-foreground">CGB/SPA Form 3</div>
            <div className="font-display text-lg font-bold">Departmental Summary</div>
            <Label className="mt-3 block text-xs">Department</Label>
            <Select value={department} onValueChange={setDepartment}>
              <SelectTrigger><SelectValue placeholder="Select a department" /></SelectTrigger>
              <SelectContent>
                {(departments ?? []).map((d) => <SelectItem key={d.name} value={d.name}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Label className="mt-2 block text-xs">Period</Label>
            <Input value={period} onChange={(e) => setPeriod(e.target.value)} />
            <Button className="mt-3 w-full" disabled={busy === "form3"} onClick={() => run("form3")}><FileText className="mr-1.5 h-4 w-4" />Generate</Button>
          </Card>

          <Card className="p-5">
            <div className="text-xs uppercase text-muted-foreground">CGB/SPA Form 4</div>
            <div className="font-display text-lg font-bold">CIPMC Recommendation</div>
            <Label className="mt-3 block text-xs">Period</Label>
            <Input value={period} onChange={(e) => setPeriod(e.target.value)} />
            <Button className="mt-3 w-full" disabled={busy === "form4"} onClick={() => run("form4")}><FileText className="mr-1.5 h-4 w-4" />Generate</Button>
          </Card>

          {/* Performance Contract Report (Enhancement 7) */}
          <Card className="p-5 border-primary/30">
            <div className="text-xs uppercase text-primary">Performance Contract Report</div>
            <div className="font-display text-lg font-bold">Contract Achievement</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Full contract layout with Cross Category, Current Status, Achievement, Unit, Weight, Type and Source columns.
            </p>
            <Label className="mt-3 block text-xs">Contract ID</Label>
            <Input value={contractId} onChange={(e) => setContractId(e.target.value)} placeholder="uuid…" />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button disabled={busy === "contract-pdf"} onClick={() => runContractReport("pdf")}>
                <FileText className="mr-1.5 h-4 w-4" />{busy === "contract-pdf" ? "…" : "PDF"}
              </Button>
              <Button variant="outline" disabled={busy === "contract-excel"} onClick={() => runContractReport("excel")}>
                <Download className="mr-1.5 h-4 w-4" />{busy === "contract-excel" ? "…" : "Excel"}
              </Button>
            </div>
          </Card>
        </div>

        <h2 className="mt-8 font-display text-xl font-bold">Historical archive</h2>
        <Card className="mt-3 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Report No.</th>
                  <th className="px-4 py-2 text-left">Type</th>
                  <th className="px-4 py-2 text-left">Department</th>
                  <th className="px-4 py-2 text-left">Period</th>
                  <th className="px-4 py-2 text-left">Generated</th>
                </tr>
              </thead>
              <tbody>
                {(archive ?? []).map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-4 py-2 font-mono text-xs">{r.report_number}</td>
                    <td className="px-4 py-2">{r.report_type}</td>
                    <td className="px-4 py-2">{r.department ?? "—"}</td>
                    <td className="px-4 py-2">{r.fiscal_year ?? r.quarter ?? "—"}</td>
                    <td className="px-4 py-2">{new Date(r.generated_at).toLocaleString()}</td>
                  </tr>
                ))}
                {(!archive || archive.length === 0) && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No reports yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="mt-3 text-xs text-muted-foreground"><Download className="mr-1 inline h-3 w-3" />Reports are downloaded to your device when generated.</div>
      </main>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Performance Contract Report generator (Enhancement 7)
// ────────────────────────────────────────────────────────────

type ObjectiveRow = {
  category: string; objective: string; current_status: string | null;
  achievement: string | null; achievement_pct: number | null;
  unit: string | null; weight: number; type: string | null; source: string | null;
};

const CATEGORY_LABELS: Record<string, string> = {
  financial_stewardship:        "Financial Stewardship and Discipline",
  service_delivery:             "Service Delivery",
  institutional_transformation: "Institutional Transformation",
  core_mandate:                 "Core Mandate",
  cross_cutting:                "Cross-Cutting Issues",
};

async function generateContractReport(contractId: string, userId: string, fmt: "pdf" | "excel") {
  // Load contract + owner profile
  const [{ data: contract }, { data: objectives }, { data: signoffs }] = await Promise.all([
    supabase.from("performance_contracts").select("*, profiles:owner_id(full_name, designation, department)").eq("id", contractId).maybeSingle(),
    supabase.from("contract_objectives").select("*").eq("contract_id", contractId).order("category").order("sort_order"),
    supabase.from("contract_signoffs").select("*").eq("contract_id", contractId).order("signed_at"),
  ]);

  if (!contract) throw new Error("Contract not found");
  const owner = (contract as Record<string, unknown>).profiles as { full_name?: string; designation?: string; department?: string } | null;
  const objs = (objectives ?? []) as unknown as ObjectiveRow[];

  if (fmt === "pdf") {
    await generateContractPDF(contract as Record<string, unknown>, owner, objs, signoffs ?? []);
  } else {
    generateContractExcel(contract as Record<string, unknown>, owner, objs);
  }
}

async function generateContractPDF(
  contract: Record<string, unknown>,
  owner: { full_name?: string; designation?: string; department?: string } | null,
  objs: ObjectiveRow[],
  signoffs: Record<string, unknown>[]
) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  // Header
  doc.setFontSize(11); doc.setFont("helvetica", "bold");
  doc.text("COUNTY GOVERNMENT OF BUNGOMA", 148, 15, { align: "center" });
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text("Staff Performance Appraisal System (SPAS)", 148, 21, { align: "center" });
  doc.setFontSize(12); doc.setFont("helvetica", "bold");
  doc.text("PERFORMANCE CONTRACT REPORT", 148, 30, { align: "center" });
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text(`Contract No: ${String(contract.contract_number ?? "—")}  ·  FY: ${String(contract.fy_label ?? "—")}  ·  Status: ${String(contract.status ?? "—")}`, 148, 36, { align: "center" });
  doc.setLineWidth(0.3); doc.line(10, 40, 287, 40);

  // Officer info
  doc.setFontSize(9);
  doc.text(`Officer: ${owner?.full_name ?? "—"}`, 10, 47);
  doc.text(`Designation: ${owner?.designation ?? "—"}`, 10, 52);
  doc.text(`Department: ${owner?.department ?? "—"}`, 10, 57);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 200, 47);

  // Group by category
  const categoryKeys = Array.from(new Set(objs.map((o) => o.category)));
  let startY = 62;

  for (const key of categoryKeys) {
    const catObjs = objs.filter((o) => o.category === key);
    const catLabel = CATEGORY_LABELS[key] ?? key;
    const catTotal = catObjs.reduce((s, o) => s + Number(o.weight ?? 0), 0);

    doc.setFontSize(9); doc.setFont("helvetica", "bold");
    doc.text(`${catLabel}  (Section weight: ${catTotal})`, 10, startY);
    startY += 3;

    autoTable(doc, {
      startY,
      head: [["Cross Category", "Current Status", "Achievement", "Unit", "Weight", "Type", "Source"]],
      body: catObjs.map((o) => [
        o.objective,
        o.current_status ?? "—",
        o.achievement_pct !== null ? `${o.achievement_pct?.toFixed(1)}%` : (o.achievement ?? "—"),
        o.unit ?? "—",
        String(o.weight ?? 0),
        o.type ?? "—",
        o.source ?? "—",
      ]),
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [34, 85, 51], textColor: 255, fontSize: 7 },
      columnStyles: { 0: { cellWidth: 70 }, 1: { cellWidth: 30 }, 2: { cellWidth: 25 }, 3: { cellWidth: 20 }, 4: { cellWidth: 15 }, 5: { cellWidth: 25 }, 6: { cellWidth: 30 } },
      margin: { left: 10, right: 10 },
    });
    startY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
    if (startY > 185) { doc.addPage(); startY = 15; }
  }

  // Signature block
  if (signoffs.length > 0 && startY < 170) {
    doc.setFontSize(9); doc.setFont("helvetica", "bold");
    doc.text("Signatures", 10, startY); startY += 5;
    for (const sig of signoffs) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(8);
      doc.text(`${String(sig.is_owner ? "Contract Owner" : "Senior Officer")}: ${String(sig.signer_name ?? "—")} · ${String(sig.signer_position ?? "")} · Signed: ${sig.signed_at ? new Date(String(sig.signed_at)).toLocaleString() : "—"}`, 10, startY);
      startY += 5;
    }
  }

  doc.save(`performance-contract-report-${String(contract.contract_number ?? contract.id ?? "").replace(/\//g, "_")}.pdf`);
}

function generateContractExcel(
  contract: Record<string, unknown>,
  owner: { full_name?: string; designation?: string; department?: string } | null,
  objs: ObjectiveRow[]
) {
  const wb = XLSX.utils.book_new();

  // Summary sheet
  const summaryData = [
    ["COUNTY GOVERNMENT OF BUNGOMA — PERFORMANCE CONTRACT REPORT"],
    [],
    ["Contract No.", String(contract.contract_number ?? "—")],
    ["FY", String(contract.fy_label ?? "—")],
    ["Status", String(contract.status ?? "—")],
    ["Officer", owner?.full_name ?? "—"],
    ["Designation", owner?.designation ?? "—"],
    ["Department", owner?.department ?? "—"],
    ["Generated", new Date().toLocaleString()],
  ];
  const wsSum = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, wsSum, "Summary");

  // Matrix sheet
  const header = ["Category", "Cross Category", "Current Status", "Achievement", "Performance Rating (%)", "Unit", "Weight", "Type", "Source"];
  const rows = objs.map((o) => [
    CATEGORY_LABELS[o.category] ?? o.category,
    o.objective,
    o.current_status ?? "",
    o.achievement ?? "",
    o.achievement_pct !== null ? o.achievement_pct : "",
    o.unit ?? "",
    o.weight,
    o.type ?? "",
    o.source ?? "",
  ]);
  const wsMatrix = XLSX.utils.aoa_to_sheet([header, ...rows]);
  // Style header row width
  wsMatrix["!cols"] = [{ wch: 35 }, { wch: 50 }, { wch: 20 }, { wch: 15 }, { wch: 18 }, { wch: 12 }, { wch: 10 }, { wch: 20 }, { wch: 25 }];
  XLSX.utils.book_append_sheet(wb, wsMatrix, "Performance Matrix");

  XLSX.writeFile(wb, `performance-contract-report-${String(contract.contract_number ?? "").replace(/\//g, "_") || "export"}.xlsx`);
}
