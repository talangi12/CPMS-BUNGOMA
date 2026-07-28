import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getNationalId } from "@/lib/appraisal-scoring";

export const generateAppraisalPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ appraisalId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");

    const { data: appraisal, error } = await supabase
      .from("appraisals")
      .select("*, targets(*)")
      .eq("id", data.appraisalId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!appraisal) throw new Error("Appraisal not found");

    // Authorization: employee, chosen supervisor, or admin viewer
    const isOwner = appraisal.employee_id === userId;
    const isSup = appraisal.chosen_supervisor_id === userId;
    if (!isOwner && !isSup) {
      const { data: isAdmin } = await supabase.rpc("is_admin_viewer", { _uid: userId });
      if (!isAdmin) throw new Error("Not authorized to generate this PDF");
    }

    const { data: emp } = await supabaseAdmin
      .from("profiles").select("*").eq("id", appraisal.employee_id).maybeSingle();
    const { data: sup } = appraisal.chosen_supervisor_id
      ? await supabaseAdmin.from("profiles").select("full_name, designation").eq("id", appraisal.chosen_supervisor_id).maybeSingle()
      : { data: null };

    // Build PDF
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const green = rgb(0.18, 0.36, 0.22);
    const gold = rgb(0.78, 0.55, 0.13);
    const ink = rgb(0.12, 0.12, 0.12);
    const muted = rgb(0.45, 0.45, 0.45);

    let page = pdf.addPage([595, 842]); // A4
    const margin = 50;
    let y = 800;

    const line = (text: string, opts: { size?: number; b?: boolean; color?: ReturnType<typeof rgb>; indent?: number } = {}) => {
      const size = opts.size ?? 10;
      if (y < 60) { page = pdf.addPage([595, 842]); y = 800; }
      page.drawText(text.slice(0, 95), {
        x: margin + (opts.indent ?? 0),
        y,
        size,
        font: opts.b ? bold : font,
        color: opts.color ?? ink,
      });
      y -= size + 4;
    };
    const sp = (n = 6) => { y -= n; };
    const hr = () => {
      page.drawLine({ start: { x: margin, y }, end: { x: 545, y }, thickness: 0.5, color: muted });
      y -= 8;
    };

    // Header
    page.drawRectangle({ x: 0, y: 800, width: 595, height: 42, color: green });
    page.drawText("County Government of Bungoma", { x: margin, y: 822, size: 14, font: bold, color: rgb(1,1,1) });
    page.drawText("County Performance Management System · Staff Performance Appraisal", { x: margin, y: 808, size: 8, font, color: rgb(1,1,1) });
    y = 780;

    line(`Appraisal Report — ${appraisal.period}`, { size: 16, b: true, color: green });
    line(`Generated ${new Date().toLocaleString()}`, { size: 8, color: muted });
    sp(8); hr();

    // Section 1
    line("Section 1 — Employment Details", { size: 12, b: true, color: green });
    sp(2);
    const kv = (k: string, v: string | null | undefined) => line(`${k}:  ${v ?? "—"}`);
    kv("Name", emp?.full_name);
    kv("National ID", getNationalId(emp));
    kv("Designation", emp?.designation);
    kv("Job Group", emp?.job_group);
    kv("Department", emp?.department);
    kv("Directorate", emp?.directorate);
    kv("Work Station", emp?.work_station);
    kv("Email", emp?.email);
    sp(6); hr();

    // Section 2A
    line("Section 2A — Performance Targets", { size: 12, b: true, color: green });
    sp(2);
    const targets = [...(appraisal.targets ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    let totalW = 0, weighted = 0;
    targets.forEach((t, i) => {
      line(`Target ${i + 1}: ${t.target ?? ""}`, { b: true });
      line(`Indicator: ${t.indicator ?? "—"}`, { indent: 12, size: 9, color: muted });
      line(`Expected: ${t.expected_outcome ?? "—"}`, { indent: 12, size: 9, color: muted });
      line(`Achieved: ${t.achieved_result ?? "—"}`, { indent: 12, size: 9, color: muted });
      line(`Weight: ${t.weight ?? 0}%   Score: ${t.score ?? 0}`, { indent: 12, size: 9 });
      if (t.midyear_progress) line(`Mid-Year progress: ${t.midyear_progress}`, { indent: 12, size: 9, color: gold });
      if (t.midyear_supervisor_comment) line(`Supervisor (mid): ${t.midyear_supervisor_comment}`, { indent: 12, size: 9, color: gold });
      sp(3);
      totalW += Number(t.weight) || 0;
      weighted += (Number(t.weight) || 0) * (Number(t.score) || 0);
    });
    const finalPct = totalW > 0 ? weighted / totalW : null;
    const rating = finalPct == null ? "—"
      : finalPct >= 101 ? "Excellent"
      : finalPct >= 85 ? "Very Good"
      : finalPct >= 65 ? "Good"
      : finalPct >= 50 ? "Fair" : "Poor";

    sp(4); hr();

    // Section 8 — Rating Matrix
    line("Section 8 — Performance Rating Matrix", { size: 12, b: true, color: green });
    sp(2);
    line(`Total weight: ${totalW}%`);
    line(`Weighted score: ${finalPct == null ? "—" : finalPct.toFixed(2) + "%"}`);
    line(`Overall rating: ${rating}`, { b: true, color: rating === "Excellent" || rating === "Very Good" ? green : ink });
    sp(4);
    const bands = [
      ["Poor", "≤ 49%"], ["Fair", "50–64%"], ["Good", "65–84%"],
      ["Very Good", "85–100%"], ["Excellent", "≥ 101%"],
    ];
    bands.forEach(([l, r]) => line(`  • ${l.padEnd(12)} ${r}`, { size: 9, color: l === rating ? green : muted, b: l === rating }));
    sp(6); hr();

    // Signatures
    line("Signatures", { size: 12, b: true, color: green });
    sp(2);
    line(`Employee: ${emp?.full_name ?? "—"}`);
    line(appraisal.employee_signed_at ? `Signed digitally on ${new Date(appraisal.employee_signed_at).toLocaleString()}` : "Not signed", { size: 9, color: muted, indent: 12 });
    sp(2);
    line(`Supervisor: ${sup?.full_name ?? "—"}${sup?.designation ? ` (${sup.designation})` : ""}`);
    line(appraisal.supervisor_signed_at ? `Signed digitally on ${new Date(appraisal.supervisor_signed_at).toLocaleString()}` : "Pending", { size: 9, color: muted, indent: 12 });
    if (appraisal.supervisor_comments) {
      sp(4);
      line("Supervisor comments:", { b: true, size: 9 });
      line(appraisal.supervisor_comments, { size: 9, color: muted });
    }

    // Footer
    const pages = pdf.getPages();
    pages.forEach((p, i) => {
      p.drawText(`Bungoma CPMS · Confidential · Page ${i + 1} of ${pages.length}`, {
        x: margin, y: 28, size: 7, font, color: muted,
      });
    });

    const bytes = await pdf.save();
    const path = `${appraisal.employee_id}/${appraisal.id}-${Date.now()}.pdf`;

    const { error: upErr } = await supabaseAdmin.storage
      .from("appraisal-pdfs")
      .upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (upErr) throw new Error(upErr.message);

    await supabaseAdmin.from("appraisals")
      .update({ pdf_path: path, pdf_generated_at: new Date().toISOString() })
      .eq("id", appraisal.id);

    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from("appraisal-pdfs").createSignedUrl(path, 60 * 10);
    if (signErr) throw new Error(signErr.message);

    return { url: signed.signedUrl, path };
  });

export const getAppraisalPdfUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ appraisalId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: a, error } = await supabase
      .from("appraisals").select("id, pdf_path, employee_id, chosen_supervisor_id").eq("id", data.appraisalId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!a?.pdf_path) return { url: null };
    const { data: signed, error: sErr } = await supabaseAdmin.storage
      .from("appraisal-pdfs").createSignedUrl(a.pdf_path, 60 * 10);
    if (sErr) throw new Error(sErr.message);
    return { url: signed.signedUrl };
  });
