import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const TARGET_ROLES = ["cec", "chief_officer", "director", "supervisor", "employee"] as const;

// Default password assigned to every new employee on import.
// User must change it on first login (must_change_password = true).
export const DEFAULT_EMPLOYEE_PASSWORD = "BUNGOMA*039";

const RowSchema = z.object({
  id_number: z.string().trim().min(4).max(20),
  full_name: z.string().trim().min(3).max(150),
  personal_number: z.string().trim().regex(/^\d{1,11}$/, "Personal Number must be up to 11 digits"),
  department: z.string().trim().min(1).max(120),
  directorate: z.string().trim().max(120).optional().default(""),
  workstation: z.string().trim().max(120).optional().default(""),
  job_group: z.string().trim().max(20).optional().default(""),
  gender: z.string().trim().max(20).optional().default(""),
  disability_status: z.string().trim().max(40).optional().default(""),
  designation: z.string().trim().max(120).optional().default(""),
  email: z.string().trim().email().optional().or(z.literal("")).default(""),
  phone: z.string().trim().max(20).optional().default(""),
});

export type ImportRow = z.infer<typeof RowSchema>;
type SupabaseAdmin = typeof import("@/integrations/supabase/client.server")["supabaseAdmin"];

async function findAuthUserByEmail(supabaseAdmin: SupabaseAdmin, email: string) {
  const needle = email.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const found = data.users.find((u) => u.email?.toLowerCase() === needle);
    if (found) return found;
    if (data.users.length < 1000) return null;
  }
  return null;
}

export const bulkImportEmployees = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      target_role: z.enum(TARGET_ROLES),
      rows: z.array(RowSchema).min(1).max(2000),
      update_existing: z.boolean().optional().default(true),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    type Result = { row: number; id_number: string; status: "created" | "updated" | "skipped" | "error"; message?: string };
    const results: Result[] = [];

    // Authorization check once per unique dept/directorate
    const seenAuth = new Map<string, boolean>();

    for (let idx = 0; idx < data.rows.length; idx++) {
      const row = data.rows[idx];
      const rowNo = idx + 2;

      const key = `${row.department}::${row.directorate ?? ""}`;
      let allowed = seenAuth.get(key);
      if (allowed === undefined) {
        const { data: ok, error: authErr } = await supabaseAdmin.rpc("can_import", {
          _actor: userId,
          _target_role: data.target_role,
          _dept: row.department,
          _directorate: row.directorate || "",
        });
        if (authErr) {
          results.push({ row: rowNo, id_number: row.id_number, status: "error", message: `Authorization error: ${authErr.message}` });
          continue;
        }
        allowed = !!ok;
        seenAuth.set(key, allowed);
      }
      if (!allowed) {
        results.push({ row: rowNo, id_number: row.id_number, status: "error", message: "Not authorised to import for this department" });
        continue;
      }

      // Lookup existing by ID number
      const { data: existing, error: lookupErr } = await supabaseAdmin
        .from("profiles")
        .select("id, email")
        .eq("id_number", row.id_number)
        .maybeSingle();
      if (lookupErr) {
        results.push({ row: rowNo, id_number: row.id_number, status: "error", message: `Lookup failed: ${lookupErr.message}` });
        continue;
      }

      if (existing) {
        if (!data.update_existing) {
          results.push({ row: rowNo, id_number: row.id_number, status: "skipped", message: "Already exists" });
          continue;
        }
        // Update profile fields in place — preserves auth user, password, history.
        const { error: updErr } = await supabaseAdmin.from("profiles").update({
          full_name: row.full_name,
          personal_number: row.personal_number,
          department: row.department,
          directorate: row.directorate || null,
          work_station: row.workstation || null,
          job_group: row.job_group || null,
          gender: row.gender || null,
          disability_status: row.disability_status || null,
          designation: row.designation || null,
          personal_email: row.email || null,
          phone_number: row.phone || null,
        }).eq("id", existing.id);
        if (updErr) {
          results.push({ row: rowNo, id_number: row.id_number, status: "error", message: `Update failed: ${updErr.message}` });
          continue;
        }
        await supabaseAdmin.rpc("log_audit", {
          _action: "employee_updated_via_import",
          _entity_type: "profiles", _entity_id: existing.id, _old: null,
          _new: { id_number: row.id_number, department: row.department },
        });
        results.push({ row: rowNo, id_number: row.id_number, status: "updated" });
        continue;
      }

      // Create new auth user — synthetic email, standard default password.
      const synthetic = `id_${row.id_number.toLowerCase()}@cpms.bungoma.local`;
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: synthetic,
        password: DEFAULT_EMPLOYEE_PASSWORD,
        email_confirm: true,
        user_metadata: {
          full_name: row.full_name,
          id_number: row.id_number,
          personal_number: row.personal_number,
          department: row.department,
          directorate: row.directorate,
          workstation: row.workstation,
          job_group: row.job_group,
          gender: row.gender,
          disability_status: row.disability_status,
          designation: row.designation,
          personal_email: row.email,
          phone_number: row.phone,
          employee_no: row.id_number,
          must_change_password: true,
          imported_by: userId,
        },
      });
      let createdUser = created.user;
      let wasCreated = true;
      if (createErr || !createdUser) {
        if (!createErr || !/already|registered|exists/i.test(createErr.message)) {
          results.push({ row: rowNo, id_number: row.id_number, status: "error", message: createErr?.message ?? "Create failed" });
          continue;
        }
        try {
          createdUser = await findAuthUserByEmail(supabaseAdmin, synthetic);
        } catch (err) {
          results.push({ row: rowNo, id_number: row.id_number, status: "error", message: err instanceof Error ? err.message : "Existing user lookup failed" });
          continue;
        }
        if (!createdUser) {
          results.push({ row: rowNo, id_number: row.id_number, status: "error", message: "Auth user already exists but could not be matched" });
          continue;
        }
        wasCreated = false;
        const { error: relinkErr } = await supabaseAdmin.auth.admin.updateUserById(createdUser.id, {
          password: DEFAULT_EMPLOYEE_PASSWORD,
          email_confirm: true,
          user_metadata: {
            ...(createdUser.user_metadata ?? {}),
            full_name: row.full_name,
            id_number: row.id_number,
            personal_number: row.personal_number,
            department: row.department,
            directorate: row.directorate,
            workstation: row.workstation,
            job_group: row.job_group,
            gender: row.gender,
            disability_status: row.disability_status,
            designation: row.designation,
            personal_email: row.email,
            phone_number: row.phone,
            employee_no: row.id_number,
            must_change_password: true,
            imported_by: userId,
          },
        });
        if (relinkErr) {
          results.push({ row: rowNo, id_number: row.id_number, status: "error", message: `Existing auth update failed: ${relinkErr.message}` });
          continue;
        }
      }

      // The auth trigger may be unavailable in some environments, so write the profile explicitly.
      const { error: profileErr } = await supabaseAdmin.from("profiles").upsert({
        id: createdUser.id,
        full_name: row.full_name,
        email: synthetic,
        employee_no: row.id_number,
        designation: row.designation || "Officer",
        job_group: row.job_group || null,
        department: row.department,
        directorate: row.directorate || null,
        work_station: row.workstation || null,
        id_number: row.id_number,
        personal_number: row.personal_number,
        gender: row.gender || null,
        disability_status: row.disability_status || null,
        must_change_password: true,
        imported_by: userId,
        imported_at: new Date().toISOString(),
        personal_email: row.email || null,
        phone_number: row.phone || null,
        employee_status: "active",
      }, { onConflict: "id" });
      if (profileErr) {
        results.push({ row: rowNo, id_number: row.id_number, status: "error", message: `Profile upsert failed: ${profileErr.message}` });
        continue;
      }

      let roleGrantFailed = false;
      for (const role of (["employee", ...(data.target_role !== "employee" ? [data.target_role] : [])] as const)) {
        const { error: roleErr } = await supabaseAdmin.from("user_roles").insert({
          user_id: createdUser.id,
          role,
          department: row.department,
        });
        if (roleErr && !/duplicate|unique/i.test(roleErr.message)) {
          results.push({ row: rowNo, id_number: row.id_number, status: "error", message: `Role grant failed: ${roleErr.message}` });
          roleGrantFailed = true;
          break;
        }
      }
      if (roleGrantFailed) continue;

      await supabaseAdmin.rpc("log_audit", {
        _action: wasCreated ? "employee_imported" : "employee_profile_relinked_via_import",
        _entity_type: "profiles", _entity_id: createdUser.id, _old: null,
        _new: { id_number: row.id_number, role: data.target_role, dept: row.department, directorate: row.directorate },
      });

      results.push({ row: rowNo, id_number: row.id_number, status: wasCreated ? "created" : "updated" });
    }

    return {
      total: data.rows.length,
      created: results.filter((r) => r.status === "created").length,
      updated: results.filter((r) => r.status === "updated").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      errors: results.filter((r) => r.status === "error").length,
      default_password: DEFAULT_EMPLOYEE_PASSWORD,
      results,
    };
  });
