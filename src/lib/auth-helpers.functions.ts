import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getPortalRouteForRoles } from "@/lib/authGuard";

type SupabaseAdmin = typeof import("@/integrations/supabase/client.server")["supabaseAdmin"];

async function findAuthUserByEmails(supabaseAdmin: SupabaseAdmin, emails: string[]) {
  const needles = new Set(emails.map((email) => email.toLowerCase()));
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const found = data.users.find((u) => needles.has(u.email?.toLowerCase() ?? ""));
    if (found) return found;
    if (data.users.length < 1000) return null;
  }
  return null;
}

// Resolve either a National ID or a Personal Number to the synthetic login email.
// Public endpoint used by the sign-in screen.
export const resolveLoginEmail = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      identifier: z.string().trim().min(3).max(40),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin.rpc("resolve_identifier", { _identifier: data.identifier });
    const row = Array.isArray(rows) ? rows[0] : null;
    if (row?.email) {
      return {
        email: row.email as string,
        must_change_password: !!row.must_change_password,
        full_name: row.full_name as string | null,
      };
    }
    // Fall back to synthetic format so we don't disclose existence
    return {
      email: `id_${data.identifier.toLowerCase()}@cpms.bungoma.local`,
      must_change_password: false,
      full_name: null as string | null,
    };
  });

// Update current user's password and clear the must_change_password flag.
export const changeOwnPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      new_password: z.string().min(8).max(128)
        .regex(/[A-Z]/, "Must contain an uppercase letter")
        .regex(/[a-z]/, "Must contain a lowercase letter")
        .regex(/\d/, "Must contain a digit")
        .regex(/[^A-Za-z0-9]/, "Must contain a symbol"),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password: data.new_password });
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("profiles").update({ must_change_password: false }).eq("id", userId);
    await supabaseAdmin.rpc("log_audit", {
      _action: "password_changed",
      _entity_type: "auth.users",
      _entity_id: userId,
      _old: null, _new: null,
    });
    return { ok: true };
  });

// Bootstrap the default super admin (010203045). Idempotent.
export const bootstrapDefaultSuperAdmin = createServerFn({ method: "POST" })
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const id = "010203045";
    const password = "0725393939";
    const email = `id_${id}@cpms.bungoma.local`;
    const legacyEmail = `id_${id}@epms.bungoma.local`;
    const seedProfile = {
      full_name: "System Super Administrator",
      email,
      employee_no: id,
      designation: "System Administrator",
      department: "Administration",
      id_number: id,
      personal_number: password,
      must_change_password: false,
      employee_status: "active" as const,
    };
    const grantAdminRoles = async (userId: string) => {
      for (const role of ["employee", "super_admin", "system_admin"] as const) {
        const { error } = await supabaseAdmin.from("user_roles").insert({ user_id: userId, role, department: null });
        if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
      }
    };

    const existing = await findAuthUserByEmails(supabaseAdmin, [email, legacyEmail]);
    if (existing) {
      const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(existing.id, {
        email,
        password,
        email_confirm: true,
        user_metadata: {
          ...(existing.user_metadata ?? {}),
          full_name: seedProfile.full_name,
          id_number: id,
          personal_number: password,
          designation: seedProfile.designation,
          department: seedProfile.department,
          must_change_password: false,
        },
      });
      if (updateErr && !/already|registered|exists/i.test(updateErr.message)) throw new Error(updateErr.message);
      await supabaseAdmin.from("profiles").upsert({ ...seedProfile, id: existing.id, email: updateErr ? (existing.email ?? email) : email }, { onConflict: "id" });
      await grantAdminRoles(existing.id);
      return { created: false, id: existing.id };
    }
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: {
        full_name: "System Super Administrator",
        id_number: id,
        personal_number: password,
        designation: "System Administrator",
        department: "Administration",
        must_change_password: false,
      },
    });
    if (error) throw new Error(error.message);
    if (created.user) {
      await supabaseAdmin.from("profiles").upsert({ ...seedProfile, id: created.user.id }, { onConflict: "id" });
      await grantAdminRoles(created.user.id);
    }
    return { created: true, id: created.user?.id };
  });

// Server-side post-login destination resolver (RLS-safe; uses admin to read profile + roles).
export const resolveLoginDestination = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prof } = await supabaseAdmin.from("profiles").select("must_change_password, id_number, email").eq("id", userId).maybeSingle();
    if (prof?.must_change_password) return { path: "/change-password" as const };

    const isBootstrapAdmin = prof?.id_number === "010203045" ;
    if (isBootstrapAdmin) return { path: "/admin" as const };

    const { data: roles } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
    const normalizedRoles = (roles ?? []).map((row) => String((row as { role?: string | null })?.role ?? "").trim());
    // If user is an appraisee and has an appraisal in 'initial_approved', redirect them to continuous-review
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: app } = await supabaseAdmin.from("appraisals").select("id, status").eq("employee_id", userId).maybeSingle();
      if (app?.status === "initial_approved") {
        return { path: "/continuous-review" as const };
      }
    } catch (e) {
      // ignore; fall back to role resolver
    }
    return { path: getPortalRouteForRoles(normalizedRoles) as "/dashboard" | "/admin" | "/super-admin" | "/governor" | "/cec" | "/chief-officer" | "/director" | "/appeals-committee" | "/department-admin" | "/supervisor" | "/external-assessor" };
  });

