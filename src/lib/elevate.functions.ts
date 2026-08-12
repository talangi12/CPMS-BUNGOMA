import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ROLES = [
  "employee", "supervisor", "external_assessor", "hr", "system_admin", "super_admin",
  "appeals_committee", "governor", "cec", "chief_officer", "director",
] as const;

// Super Admin one-click self role elevation toggle. Grants/revokes any role
// on the calling super_admin's own account. Every change is auto-logged.
export const toggleSelfRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      role: z.enum(ROLES),
      enable: z.boolean(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Verify caller is a super_admin.
    const { data: isSuper } = await supabaseAdmin.rpc("has_role", {
      _user_id: userId, _role: "super_admin",
    });
    if (!isSuper) throw new Error("Only Super Admins may self-elevate.");

    if (data.role === "super_admin" && !data.enable) {
      // Prevent locking yourself out of super_admin via this toggle.
      throw new Error("Cannot remove your own Super Admin role from this screen.");
    }

    if (data.enable) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: userId, role: data.role }, { onConflict: "user_id,role,department", ignoreDuplicates: true } as never);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", userId)
        .eq("role", data.role);
      if (error) throw new Error(error.message);
    }

    await supabaseAdmin.rpc("log_audit", {
      _action: data.enable ? "self_role_granted" : "self_role_revoked",
      _entity_type: "user_roles",
      _entity_id: userId,
      _old: null,
      _new: { role: data.role } as never,
    });

    return { ok: true, role: data.role, enabled: data.enable };
  });

// Read current roles for the caller (server-side, RLS-safe).
export const listMyRoles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => (r as { role: string }).role);
  });
