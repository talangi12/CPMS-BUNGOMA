import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const searchEmployees = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      query: z.string().trim().min(1).max(50),
      mode: z.enum(["id_number", "personal_number"]).default("id_number"),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const col = data.mode === "personal_number" ? "personal_number" : "id_number";

    const { data: rows, error } = await supabase
      .from("profiles")
      .select("id, full_name, id_number, personal_number, department, directorate, job_group, designation, employment_status, gender, disability_status, work_station, supervisor_id")
      .eq(col, data.query)
      .limit(10);
    if (error) throw new Error(error.message);

    // Filter by can_view_profile scope
    const allowed: typeof rows = [];
    for (const r of rows ?? []) {
      const { data: ok } = await supabase.rpc("can_view_profile", { _actor: userId, _target: r.id });
      if (ok) allowed.push(r);
    }
    return allowed;
  });
