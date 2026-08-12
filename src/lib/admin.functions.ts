import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ROLES = [
  "employee", "supervisor", "external_assessor", "hr", "system_admin", "super_admin",
  "appeals_committee", "governor", "cec", "chief_officer", "director",
] as const;

const EMPLOYMENT_STATUSES = ["active", "suspended", "archived", "terminated"] as const;

export const createUserWithRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      id_number: z.string().trim().min(3).max(20),
      personal_number: z.string().trim().min(1).max(20),
      full_name: z.string().trim().min(2).max(150),
      email: z.string().trim().email(),
      phone: z.string().trim().min(7).max(20),
      department: z.string().trim().min(1).max(120),
      directorate: z.string().trim().max(120).optional().default(""),
      section: z.string().trim().max(120).optional().default(""),
      designation: z.string().trim().min(1).max(120),
      role: z.enum(ROLES),
      role_department: z.string().trim().max(120).optional().default(""),
      employee_status: z.enum(EMPLOYMENT_STATUSES).default("active"),
      password: z.string().min(6).max(128),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: isSys }, { data: isSuper }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "system_admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "super_admin" }),
    ]);
    if (!isSys && !isSuper) throw new Error("Only System Admins can create accounts");
    if (data.role === "super_admin" && !isSuper) throw new Error("Only Super Admins can create Super Admin accounts");

    // Duplicate prevention
    const dupChecks = await supabaseAdmin
      .from("profiles")
      .select("id, id_number, personal_number, email")
      .or(
        `id_number.eq.${data.id_number},personal_number.eq.${data.personal_number},email.eq.${data.email.toLowerCase()}`,
      );
    if (dupChecks.error) throw new Error(dupChecks.error.message);
    if ((dupChecks.data ?? []).length > 0) {
      const d = dupChecks.data![0];
      if (d.id_number === data.id_number) throw new Error("A user with this National ID already exists");
      if (d.personal_number === data.personal_number) throw new Error("A user with this Payroll Number already exists");
      throw new Error("A user with this email already exists");
    }

    // Login email: synthetic so the user can sign in by National ID or Payroll Number via resolve_identifier.
    const syntheticEmail = `id_${data.id_number.toLowerCase()}@cpms.bungoma.local`;

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: syntheticEmail,
      password: data.password,
      email_confirm: true,
      user_metadata: {
        full_name: data.full_name,
        id_number: data.id_number,
        personal_number: data.personal_number,
        department: data.department,
        directorate: data.directorate,
        section: data.section,
        designation: data.designation,
        phone_number: data.phone,
        personal_email: data.email,
        employee_no: data.id_number,
        must_change_password: false,
        created_by_admin: userId,
      },
    });
    if (error) throw new Error(error.message);
    const newId = created.user?.id;
    if (!newId) throw new Error("User creation returned no id");

    // Make sure the profile row exists with every captured field (the auth trigger may not fire in all envs).
    const { error: profErr } = await supabaseAdmin.from("profiles").upsert({
      id: newId,
      full_name: data.full_name,
      email: syntheticEmail,
      personal_email: data.email,
      employee_no: data.id_number,
      id_number: data.id_number,
      personal_number: data.personal_number,
      phone_number: data.phone,
      designation: data.designation,
      department: data.department,
      directorate: data.directorate || null,
      section: data.section || null,
      employee_status: data.employee_status,
      must_change_password: false,
    }, { onConflict: "id" });
    if (profErr) throw new Error(profErr.message);

    // Grant base employee role, then the assigned role (scoped to department).
    const wantRoles: Array<{ role: typeof ROLES[number]; department: string | null }> = [
      { role: "employee", department: null },
    ];
    if (data.role !== "employee") {
      wantRoles.push({ role: data.role, department: data.role_department || data.department });
    }
    for (const r of wantRoles) {
      const { error: rErr } = await supabaseAdmin.from("user_roles").insert({
        user_id: newId, role: r.role, department: r.department,
      });
      if (rErr && !/duplicate|unique/i.test(rErr.message)) throw new Error(rErr.message);
    }
    return { id: newId, email: syntheticEmail, login_id: data.id_number, login_personal_no: data.personal_number };
  });

// One-shot bootstrap for the super26 admin account. Idempotent.
export const bootstrapSuperAdmin = createServerFn({ method: "POST" })
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = "super26@bungoma.go.ke";
    const password = "Da2th26!";
    const { data: list, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (listErr) throw new Error(listErr.message);
    const existing = list.users.find((u) => u.email?.toLowerCase() === email);
    if (existing) {
      await supabaseAdmin.from("user_roles").upsert([
        { user_id: existing.id, role: "super_admin" },
        { user_id: existing.id, role: "system_admin" },
      ], { onConflict: "user_id,role,department", ignoreDuplicates: true } as never);
      return { created: false, id: existing.id, email };
    }
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { full_name: "System Super Admin", designation: "System Administrator", department: "Administration" },
    });
    if (error) throw new Error(error.message);
    return { created: true, id: created.user?.id, email };
  });
