import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type ProgressInput = {
  appraisal_id: string;
  target_id: string;
  quarter: number;
  progress_note?: string | null;
  achieved_value?: string | null;
  self_score?: number | null;
  evidence_url?: string | null;
};

export const saveQuarterProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: ProgressInput) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // verify caller owns the appraisal
    const { data: appraisal, error: aerr } = await supabase
      .from("appraisals")
      .select("id, employee_id")
      .eq("id", data.appraisal_id)
      .maybeSingle();
    if (aerr) throw aerr;
    if (!appraisal || appraisal.employee_id !== userId) throw new Error("Not your appraisal");
    if (data.quarter < 1 || data.quarter > 4) throw new Error("Invalid quarter");

    const { error } = await supabase
      .from("target_quarter_progress")
      .upsert(
        {
          appraisal_id: data.appraisal_id,
          target_id: data.target_id,
          quarter: data.quarter,
          progress_note: data.progress_note ?? null,
          achieved_value: data.achieved_value ?? null,
          self_score: data.self_score ?? null,
          evidence_url: data.evidence_url ?? null,
          submitted_at: new Date().toISOString(),
        },
        { onConflict: "target_id,quarter" },
      );
    if (error) throw error;
    return { ok: true };
  });

export const reviewQuarterProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; supervisor_score: number; supervisor_comment?: string | null }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error: rerr } = await supabase
      .from("target_quarter_progress")
      .select("id, appraisal_id, appraisals!inner(chosen_supervisor_id, employee_id)")
      .eq("id", data.id)
      .maybeSingle();
    if (rerr) throw rerr;
    if (!row) throw new Error("Not found");
    const app = row.appraisals as { chosen_supervisor_id: string | null; employee_id: string };
    let canReview = app.chosen_supervisor_id === userId;
    if (!canReview) {
      const { data: ok } = await supabase.rpc("can_sign_as_supervisor", { _actor: userId, _employee: app.employee_id });
      canReview = !!ok;
    }
    if (!canReview) throw new Error("Not authorised to review");

    const { error } = await supabase
      .from("target_quarter_progress")
      .update({
        supervisor_score: data.supervisor_score,
        supervisor_comment: data.supervisor_comment ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
