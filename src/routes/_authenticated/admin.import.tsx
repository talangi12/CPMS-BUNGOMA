import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useRef, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import * as XLSX from "xlsx";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useRoles, hasAnyRole } from "@/hooks/useRoles";
import { UploadCloud, ShieldCheck, FileSpreadsheet, Download, FileWarning } from "lucide-react";
import { bulkImportEmployees, DEFAULT_EMPLOYEE_PASSWORD, type ImportRow } from "@/lib/import.functions";

export const Route = createFileRoute("/_authenticated/admin/import")({
  head: () => ({ meta: [{ title: "Bulk Import — Bungoma CPMS" }] }),
  component: ImportPage,
});

const HEADERS = ["id_number","full_name","personal_number","department","directorate","workstation","job_group","gender","disability_status","designation","email","phone"] as const;
const SAMPLE_ROW = ["12345678","John Wafula Wanyonyi","1234567","Agriculture","Crops","Kanduyi","K","Male","None","Officer","jwafula@bungoma.go.ke","+254712345678"];
const TEMPLATE_CSV = HEADERS.join(",") + "\n" + SAMPLE_ROW.join(",");
const BATCH_SIZE = 100;

const TARGET_ROLES = [
  { value: "cec", label: "CEC (created by Governor)" },
  { value: "chief_officer", label: "Chief Officer (created by CEC)" },
  { value: "director", label: "Director (created by Chief Officer)" },
  { value: "supervisor", label: "Supervisor (created by Director)" },
  { value: "employee", label: "Employee / Appraisee (created by Director)" },
] as const;

type ValidationIssue = { row: number; id_number: string; error: string; fix: string };

function normaliseRow(o: Record<string, unknown>): ImportRow {
  const get = (k: string) => String(o[k] ?? o[k.toUpperCase()] ?? o[k.replace(/_/g, " ")] ?? "").trim();
  return {
    id_number: get("id_number") || get("national_id") || get("id"),
    full_name: get("full_name") || get("name"),
    personal_number: get("personal_number") || get("payroll_no") || get("employee_no"),
    department: get("department"),
    directorate: get("directorate"),
    workstation: get("workstation") || get("work_station"),
    job_group: get("job_group"),
    gender: get("gender"),
    disability_status: get("disability_status") || get("disability"),
    designation: get("designation") || get("job_title"),
    email: get("email") || get("personal_email"),
    phone: get("phone") || get("phone_number") || get("mobile"),
  };
}

function parseCSV(text: string): ImportRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cols = line.split(",").map((c) => c.trim());
    const obj: Record<string, string> = {};
    header.forEach((h, i) => { obj[h] = cols[i] ?? ""; });
    return normaliseRow(obj);
  });
}

function validateRows(rows: ImportRow[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenId = new Set<string>();
  const seenPN = new Set<string>();
  rows.forEach((r, i) => {
    const rowNo = i + 2;
    if (!r.id_number || r.id_number.length < 4) issues.push({ row: rowNo, id_number: r.id_number, error: "id_number missing/too short", fix: "Enter the 6–10 digit National ID" });
    if (!r.full_name || r.full_name.length < 3) issues.push({ row: rowNo, id_number: r.id_number, error: "full_name missing", fix: "Enter the employee's full legal name" });
    if (!/^\d{1,11}$/.test(r.personal_number)) issues.push({ row: rowNo, id_number: r.id_number, error: "personal_number must be digits (max 11)", fix: "Use payroll number digits only, no spaces" });
    if (!r.department) issues.push({ row: rowNo, id_number: r.id_number, error: "department required", fix: "Add the parent department name" });
    if (r.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) issues.push({ row: rowNo, id_number: r.id_number, error: "email is invalid", fix: "Use the format name@domain.tld" });
    if (r.phone && !/^[+0-9\- ]{7,20}$/.test(r.phone)) issues.push({ row: rowNo, id_number: r.id_number, error: "phone format invalid", fix: "Use digits, spaces, dashes or leading +" });
    if (r.id_number && seenId.has(r.id_number)) issues.push({ row: rowNo, id_number: r.id_number, error: "duplicate id_number in file", fix: "Remove the duplicate row" });
    if (r.personal_number && seenPN.has(r.personal_number)) issues.push({ row: rowNo, id_number: r.id_number, error: "duplicate personal_number in file", fix: "Remove the duplicate row" });
    seenId.add(r.id_number); seenPN.add(r.personal_number);
  });
  return issues;
}

type ImportResult = Awaited<ReturnType<typeof bulkImportEmployees>>;

function ImportPage() {
  const { user } = Route.useRouteContext();
  const { data: roles, isLoading } = useRoles(user.id);
  const allowed = hasAnyRole(roles, ["governor", "cec", "chief_officer", "director", "system_admin", "super_admin"]);
  const importFn = useServerFn(bulkImportEmployees);

  const [csv, setCsv] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [targetRole, setTargetRole] = useState<typeof TARGET_ROLES[number]["value"]>("employee");
  const [updateExisting, setUpdateExisting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const issues = useMemo(() => validateRows(rows), [rows]);
  const validCount = rows.length - new Set(issues.map((i) => i.row)).size;

  const ingest = useCallback((file: File) => {
    if (file.size > 25 * 1024 * 1024) return toast.error("File must be 25MB or smaller");
    const ext = file.name.toLowerCase();
    if (ext.endsWith(".csv")) {
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result ?? "");
        setCsv(text);
        const parsed = parseCSV(text);
        setRows(parsed);
        toast.success(`Loaded ${parsed.length} row${parsed.length === 1 ? "" : "s"} from ${file.name}`);
      };
      reader.readAsText(file);
    } else if (ext.endsWith(".xlsx") || ext.endsWith(".xls")) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const wb = XLSX.read(reader.result, { type: "array" });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
          const parsed = json.map((o) => {
            const lower: Record<string, unknown> = {};
            for (const k of Object.keys(o)) lower[k.toLowerCase().replace(/\s+/g, "_")] = o[k];
            return normaliseRow(lower);
          });
          setRows(parsed);
          setCsv("");
          toast.success(`Loaded ${parsed.length} row${parsed.length === 1 ? "" : "s"} from ${file.name}`);
        } catch (e) { toast.error(e instanceof Error ? e.message : "Could not parse Excel"); }
      };
      reader.readAsArrayBuffer(file);
    } else {
      toast.error("Use a .csv, .xlsx, or .xls file");
    }
  }, []);

  function onTextarea(text: string) {
    setCsv(text);
    setRows(parseCSV(text));
  }

  function downloadIssues() {
    const csv = "row,id_number,error,suggested_correction\n" + issues.map((i) => `${i.row},${i.id_number},"${i.error.replace(/"/g, '""')}","${i.fix.replace(/"/g, '""')}"`).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "import-validation-errors.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  async function submit() {
    if (rows.length === 0) return toast.error("No rows parsed");
    if (issues.length > 0) return toast.error(`Fix ${issues.length} validation issue${issues.length === 1 ? "" : "s"} first`);
    setBusy(true);
    setProgress({ done: 0, total: rows.length });

    // Batch processing: process in 100-row chunks so 8,000+ auth accounts can be created without one oversized request timing out.
    const merged: ImportResult = { total: rows.length, created: 0, updated: 0, skipped: 0, errors: 0, default_password: DEFAULT_EMPLOYEE_PASSWORD, results: [] };
    try {
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const slice = rows.slice(i, i + BATCH_SIZE);
        const res = await importFn({ data: { target_role: targetRole, rows: slice, update_existing: updateExisting } });
        merged.created += res.created; merged.updated += res.updated; merged.skipped += res.skipped; merged.errors += res.errors;
        // Adjust row numbers from the batch back into the file context
        merged.results.push(...res.results.map((r) => ({ ...r, row: r.row + i })));
        setProgress({ done: Math.min(i + BATCH_SIZE, rows.length), total: rows.length });
      }
      setResult(merged);
      toast.success(`Created ${merged.created} · Updated ${merged.updated} · Skipped ${merged.skipped} · Errors ${merged.errors}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally { setBusy(false); }
  }

  if (!isLoading && !allowed) {
    return (
      <div className="min-h-screen bg-background"><AppHeader authenticated userId={user.id} />
        <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <Card className="p-10 text-center"><ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground" />
            <h1 className="mt-3 font-display text-2xl font-bold">Importers only</h1>
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
          <div className="text-xs font-semibold uppercase tracking-widest text-primary">Administration</div>
          <h1 className="mt-2 font-display text-3xl font-bold flex items-center gap-2"><UploadCloud className="h-7 w-7 text-primary" /> Bulk employee import</h1>
          <p className="mt-1 text-sm text-muted-foreground">Drag-and-drop CSV or Excel, preview, validate, then import in safe background batches — built to ingest 8,000+ employees in one run. New accounts receive the default password <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{DEFAULT_EMPLOYEE_PASSWORD}</code> and must change it on first login.</p>
        </div>

        <Card className="mt-6 p-5">
          <h2 className="font-display text-sm font-bold flex items-center gap-2"><FileSpreadsheet className="h-4 w-4 text-primary" /> Template</h2>
          <p className="mt-1 text-xs text-muted-foreground">Use these column headers exactly. Excel users can save as .xlsx; the system also accepts .csv. <strong>email</strong> &amp; <strong>phone</strong> are used for password-reset OTPs.</p>
          <pre className="mt-2 rounded-md border border-border bg-muted/30 p-3 text-[10px] overflow-x-auto">{TEMPLATE_CSV}</pre>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(TEMPLATE_CSV); toast.success("Copied"); }}>Copy CSV</Button>
            <Button size="sm" variant="outline" onClick={() => {
              const blob = new Blob([TEMPLATE_CSV], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a"); a.href = url; a.download = "cpms-template.csv"; a.click(); URL.revokeObjectURL(url);
            }}><Download className="mr-1.5 h-3.5 w-3.5" /> Download .csv</Button>
            <Button size="sm" variant="outline" onClick={() => {
              const ws = XLSX.utils.aoa_to_sheet([Array.from(HEADERS), SAMPLE_ROW]);
              const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Employees");
              XLSX.writeFile(wb, "cpms-template.xlsx");
            }}><Download className="mr-1.5 h-3.5 w-3.5" /> Download .xlsx</Button>
          </div>
        </Card>

        <Card className="mt-6 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Target role to create</Label>
              <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={targetRole} onChange={(e) => setTargetRole(e.target.value as typeof targetRole)}>
                {TARGET_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} />
                Update matching existing employees (otherwise skip duplicates)
              </label>
            </div>
            <div className="flex items-end justify-end gap-2">
              <Badge variant="secondary">Parsed: {rows.length}</Badge>
              <Badge variant={issues.length === 0 ? "default" : "destructive"}>Valid: {Math.max(0, validCount)}</Badge>
              {issues.length > 0 && <Badge variant="destructive">Issues: {issues.length}</Badge>}
            </div>
          </div>

          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) ingest(f); }}
            className={`mt-4 rounded-lg border-2 border-dashed p-8 text-center transition ${dragOver ? "border-primary bg-primary/5" : "border-border bg-muted/20"}`}
          >
            <UploadCloud className={`mx-auto h-10 w-10 ${dragOver ? "text-primary" : "text-muted-foreground"}`} />
            <p className="mt-2 text-sm font-medium">Drop your file here</p>
            <p className="text-xs text-muted-foreground">.csv · .xlsx · .xls — up to 25MB / 7,000+ rows</p>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" hidden onChange={(e) => e.target.files?.[0] && ingest(e.target.files[0])} />
            <Button className="mt-3" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>Or browse…</Button>
            {(rows.length > 0 || csv) && <Button className="mt-3 ml-2" variant="ghost" size="sm" onClick={() => { setRows([]); setCsv(""); setResult(null); if (fileRef.current) fileRef.current.value = ""; }}>Clear</Button>}
          </div>

          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-muted-foreground">Or paste CSV rows manually</summary>
            <Textarea rows={6} className="mt-2 font-mono text-xs" value={csv} onChange={(e) => onTextarea(e.target.value)} placeholder={TEMPLATE_CSV} />
          </details>
        </Card>

        {issues.length > 0 && (
          <Card className="mt-6 border-destructive/30 bg-destructive/5 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-sm font-bold flex items-center gap-2 text-destructive"><FileWarning className="h-4 w-4" /> Validation report</h2>
                <p className="mt-1 text-xs text-muted-foreground">{issues.length} issue{issues.length === 1 ? "" : "s"} must be fixed before import.</p>
              </div>
              <Button size="sm" variant="outline" onClick={downloadIssues}><Download className="mr-1.5 h-3.5 w-3.5" /> Download report</Button>
            </div>
            <div className="mt-3 max-h-56 overflow-y-auto rounded-md border border-border bg-background">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-left uppercase tracking-wider"><tr><th className="px-2 py-1">Row</th><th>ID</th><th>Issue</th><th>Suggested fix</th></tr></thead>
                <tbody>
                  {issues.map((i, k) => (
                    <tr key={k} className="border-t border-border"><td className="px-2 py-1 font-mono">{i.row}</td><td className="font-mono">{i.id_number || "—"}</td><td className="text-destructive">{i.error}</td><td className="text-muted-foreground">{i.fix}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {rows.length > 0 && (
          <Card className="mt-6 p-5">
            <h2 className="font-display text-sm font-bold">Preview ({rows.length} rows)</h2>
            <div className="mt-3 max-h-72 overflow-auto rounded-md border border-border">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-muted/60 text-left uppercase tracking-wider">
                  <tr>{HEADERS.map((h) => <th key={h} className="px-2 py-1.5 whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.slice(0, 50).map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      {HEADERS.map((h) => <td key={h} className="px-2 py-1 whitespace-nowrap">{(r as Record<string, string>)[h] || "—"}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 50 && <p className="mt-2 text-xs text-muted-foreground">Showing first 50 of {rows.length} rows.</p>}
          </Card>
        )}

        <div className="mt-6 flex items-center justify-between gap-3">
          {busy && progress.total > 0 && (
            <div className="flex-1">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{progress.done.toLocaleString()} / {progress.total.toLocaleString()} processed</p>
            </div>
          )}
          <Button disabled={busy || rows.length === 0 || issues.length > 0} onClick={submit}>
            {busy ? "Importing…" : `Import ${rows.length.toLocaleString()} record${rows.length === 1 ? "" : "s"}`}
          </Button>
        </div>

        {result && (
          <Card className="mt-6 p-5">
            <h2 className="font-display text-sm font-bold">Result</h2>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <Badge variant="default">Created {result.created}</Badge>
              <Badge variant="secondary">Updated {result.updated}</Badge>
              <Badge variant="outline">Skipped {result.skipped}</Badge>
              <Badge variant="destructive">Errors {result.errors}</Badge>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">New accounts can sign in with their National ID or Personal Number using the default password <code className="rounded bg-muted px-1.5 py-0.5">{result.default_password}</code>, then will be forced to change it.</p>
            <div className="mt-3 max-h-72 overflow-y-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-left uppercase tracking-wider"><tr><th className="px-2 py-1">Row</th><th>ID</th><th>Status</th><th>Message</th></tr></thead>
                <tbody>
                  {result.results.map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-2 py-1 font-mono">{r.row}</td>
                      <td className="px-2 py-1 font-mono">{r.id_number}</td>
                      <td className={r.status === "created" ? "text-primary" : r.status === "error" ? "text-destructive" : r.status === "updated" ? "text-emerald-700" : "text-muted-foreground"}>{r.status}</td>
                      <td className="px-2 py-1 text-muted-foreground">{r.message ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}
