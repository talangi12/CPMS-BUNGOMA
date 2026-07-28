import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Signoffs = Record<string, { name?: string; signed_at?: string } | undefined>;

const REQUIRED_SIGNATURES = ["appraisee", "supervisor", "director_endorsement"] as const;

export const generateAppraisalReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ appraisalId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI Gateway not configured");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: app, error } = await supabaseAdmin
      .from("appraisals")
      .select("*, targets(*), employee:profiles!appraisals_employee_id_fkey(*)")
      .eq("id", data.appraisalId)
      .maybeSingle();
    if (error || !app) throw new Error("Appraisal not found");

    // Authorize: employee, supervisor, or admin
    const allowed = app.employee_id === context.userId
      || app.chosen_supervisor_id === context.userId
      || (await context.supabase.rpc("is_admin_viewer", { _uid: context.userId })).data === true;
    if (!allowed) throw new Error("Not authorised");

    // Enforce all signatures captured
    const signoffs = (app.cycle_signoffs ?? {}) as Signoffs;
    const missing = REQUIRED_SIGNATURES.filter((k) => !signoffs[k]?.signed_at);
    if (missing.length > 0) {
      throw new Error(`All signatures required before report. Missing: ${missing.join(", ")}`);
    }

    const targets = (app.targets ?? []) as Array<{ target: string; indicator: string; weight: number; expected_outcome: string; achieved_result: string; score: number }>;
    const totalScore = targets.reduce((s, t) => s + (Number(t.score) || 0) * (Number(t.weight) || 0) / 100, 0);
    const employee = app.employee as { full_name?: string; designation?: string; department?: string; directorate?: string; job_group?: string } | null;

    const prompt = `You are a senior HR analyst at the County Government of Bungoma writing a formal Performance Appraisal Narrative Report.
Produce a professional, government-grade report (markdown). Cover: Executive Summary, Employee Profile, Target Performance Analysis (per target with weighted contribution), Strengths, Areas for Improvement, Recommendations for the next cycle, and Final Verdict.

EMPLOYEE
Name: ${employee?.full_name ?? "—"}
Designation: ${employee?.designation ?? "—"}
Department: ${employee?.department ?? "—"}  Directorate: ${employee?.directorate ?? "—"}  Job Group: ${employee?.job_group ?? "—"}

CYCLE
Period: ${app.period}  Weighted Total Score: ${totalScore.toFixed(2)}%  Rating: ${app.rating ?? "n/a"}

TARGETS (${targets.length})
${targets.map((t, i) => `${i + 1}. ${t.target} | Indicator: ${t.indicator} | Weight: ${t.weight}% | Expected: ${t.expected_outcome} | Achieved: ${t.achieved_result} | Score: ${t.score}%`).join("\n")}

EMPLOYEE COMMENTS: ${app.employee_comments ?? "—"}
SUPERVISOR COMMENTS: ${app.supervisor_comments ?? "—"}
RECOMMENDATION: ${app.recommendation ?? "—"}`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "You are a precise, formal performance management analyst writing structured reports for a public-sector HR office." },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      if (resp.status === 429) throw new Error("AI rate limit reached. Please try again shortly.");
      if (resp.status === 402) throw new Error("AI credits exhausted. Add credits to your Lovable workspace.");
      throw new Error(`AI gateway error ${resp.status}: ${txt.slice(0, 200)}`);
    }
    const json = await resp.json();
    const narrative = json?.choices?.[0]?.message?.content ?? "";
    if (!narrative) throw new Error("Empty AI response");

    const { data: saved, error: insErr } = await supabaseAdmin.from("ai_reports").insert({
      appraisal_id: data.appraisalId,
      generated_by: context.userId,
      model: "google/gemini-3-flash-preview",
      narrative,
      metrics: { totalScore, targetCount: targets.length, rating: app.rating },
    }).select("id, created_at").single();
    if (insErr) throw insErr;

    return { id: saved.id, narrative, createdAt: saved.created_at };
  });

export const getLatestAppraisalReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ appraisalId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("ai_reports").select("*")
      .eq("appraisal_id", data.appraisalId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    return row;
  });
