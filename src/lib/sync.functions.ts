import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(supabase: { rpc: (n: "is_admin_viewer", a: { _uid: string }) => unknown }, userId: string) {
  const { data } = (await (supabase.rpc("is_admin_viewer", { _uid: userId }) as Promise<{ data: boolean | null }>));
  if (!data) throw new Error("Admin only");
}

export const getSyncStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: schedule }, { data: logs }] = await Promise.all([
      supabaseAdmin.from("sync_schedule").select("*").eq("id", 1).maybeSingle(),
      supabaseAdmin.from("sync_logs").select("*").order("started_at", { ascending: false }).limit(25),
    ]);
    return { schedule, logs: logs ?? [] };
  });

export const updateSyncSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      frequency: z.enum(["manual", "daily", "weekly"]),
      endpoint_url: z.string().url().optional().or(z.literal("")),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("sync_schedule").update({
      frequency: data.frequency,
      endpoint_url: data.endpoint_url || null,
      updated_at: new Date().toISOString(),
    }).eq("id", 1);
    return { ok: true };
  });

export const triggerPayrollSyncNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      records: z.array(z.object({
        id_number: z.string(),
        personal_number: z.string().optional(),
        full_name: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        designation: z.string().optional(),
        job_group: z.string().optional(),
        department: z.string().optional(),
        directorate: z.string().optional(),
        work_station: z.string().optional(),
        section: z.string().optional(),
        unit: z.string().optional(),
        employment_status: z.string().optional(),
        employment_date: z.string().optional(),
        gender: z.string().optional(),
        disability_status: z.string().optional(),
        employee_no: z.string().optional(),
      })).min(1).max(5000),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: logRow } = await supabaseAdmin.from("sync_logs").insert({
      source: "manual_admin",
      status: "running",
      processed: data.records.length,
    }).select("id").single();

    let created = 0, updated = 0, failed = 0;
    const errors: { id_number: string; error: string }[] = [];

    for (const r of data.records) {
      if (!r.id_number) { failed++; errors.push({ id_number: "(missing)", error: "id_number required" }); continue; }
      const email = r.email?.trim().toLowerCase() || `id_${r.id_number.toLowerCase()}@epms.bungoma.local`;
      const password = r.personal_number || r.id_number;

      const { data: existing } = await supabaseAdmin
        .from("profiles").select("id").eq("id_number", r.id_number).maybeSingle();
      let userId = existing?.id as string | undefined;

      if (!userId) {
        const { data: cu, error: cerr } = await supabaseAdmin.auth.admin.createUser({
          email, password, email_confirm: true,
          user_metadata: {
            full_name: r.full_name ?? "", id_number: r.id_number,
            personal_number: r.personal_number ?? null,
            designation: r.designation ?? "Officer",
            department: r.department ?? "Administration",
            directorate: r.directorate ?? null,
            workstation: r.work_station ?? null,
            job_group: r.job_group ?? null,
            gender: r.gender ?? null,
            disability_status: r.disability_status ?? null,
            employee_no: r.employee_no ?? null,
            must_change_password: false,
          },
        });
        if (cerr || !cu.user) { failed++; errors.push({ id_number: r.id_number, error: cerr?.message ?? "create failed" }); continue; }
        userId = cu.user.id; created++;
      } else { updated++; }

      const status = (r.employment_status ?? "active").toLowerCase();
      const disabled = ["retired", "terminated"].includes(status);

      await supabaseAdmin.from("profiles").update({
        full_name: r.full_name ?? undefined,
        phone: r.phone ?? undefined,
        designation: r.designation ?? undefined,
        job_group: r.job_group ?? undefined,
        department: r.department ?? undefined,
        directorate: r.directorate ?? undefined,
        work_station: r.work_station ?? undefined,
        section: r.section ?? undefined,
        unit: r.unit ?? undefined,
        employment_date: r.employment_date ?? undefined,
        employment_status: status,
        gender: r.gender ?? undefined,
        disability_status: r.disability_status ?? undefined,
        employee_no: r.employee_no ?? undefined,
        personal_number: r.personal_number ?? undefined,
        email,
      }).eq("id", userId);

      // Disable auth for retired/terminated
      if (disabled && userId) {
        await supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
      }
    }

    await supabaseAdmin.from("sync_logs").update({
      status: failed > 0 ? "partial" : "success",
      created, updated, errors: failed,
      details: { errors: errors.slice(0, 100) },
      finished_at: new Date().toISOString(),
    }).eq("id", logRow!.id);

    await supabaseAdmin.from("sync_schedule").update({ last_run_at: new Date().toISOString() }).eq("id", 1);

    return { created, updated, failed, errors };
  });
