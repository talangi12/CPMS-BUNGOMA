import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getAdminMatrixDepartments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: roleRows, error: roleError }, { data: orgRows, error: orgError }] = await Promise.all([
      supabase.from("user_roles").select("department").eq("user_id", context.userId).eq("role", "dept_admin"),
      supabaseAdmin.from("org_units").select("department").not("department", "is", null),
    ]);

    if (roleError) throw new Error(roleError.message);
    if (orgError) throw new Error(orgError.message);

    const assignedDepartments = Array.from(new Set((roleRows ?? []).map((r) => r.department).filter(Boolean) as string[])).sort();
    const orgDepartments = Array.from(new Set((orgRows ?? []).map((r) => r.department).filter(Boolean) as string[])).sort();

    return Array.from(new Set([...assignedDepartments, ...orgDepartments].filter(Boolean))).sort();
  });
