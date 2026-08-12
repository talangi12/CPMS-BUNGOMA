import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppRole, hasAdminAccess } from "@/hooks/useRoles";

type RoleLike = string | AppRole | null | undefined;

export function getPortalRouteForRoles(roles: Array<RoleLike> | null | undefined) {
  const normalized = (roles ?? [])
    .map((role) => String(role ?? "").trim().toLowerCase())
    .filter(Boolean);

  if (normalized.includes("super_admin")) return "/super-admin";
  if (normalized.includes("system_admin")) return "/admin";
  if (normalized.includes("governor")) return "/governor";
  if (normalized.includes("cec")) return "/cec";
  if (normalized.includes("chief_officer")) return "/chief-officer";
  if (normalized.includes("director")) return "/director";
  if (normalized.includes("appeals_committee")) return "/appeals-committee";
  if (normalized.includes("dept_admin")) return "/department-admin";
  if (normalized.includes("supervisor")) return "/supervisor";
  if (normalized.includes("external_assessor")) return "/external-assessor";
  return "/dashboard";
}

export async function getCurrentUserRoles() {
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    throw redirect({ to: "/auth" });
  }

  const { data: roles, error: roleError } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id);

  if (roleError) {
    throw redirect({ to: "/dashboard" });
  }

  return {
    user: data.user,
    roles: (roles ?? []).map((r) => r.role as AppRole),
  };
}

export async function requireAdmin() {
  const { user, roles } = await getCurrentUserRoles();

  if (!hasAdminAccess(roles)) {
    throw redirect({ to: "/dashboard" });
  }

  return user;
}

export async function requireRole(allowedRoles: AppRole[]) {
  const { user, roles } = await getCurrentUserRoles();

  const allowed = roles.some((role) => allowedRoles.includes(role));

  if (!allowed) {
    throw redirect({ to: "/dashboard" });
  }

  return user;
}

export async function requirePortalAccess(allowedRoles: AppRole[], fallbackPath = "/dashboard") {
  const { user, roles } = await getCurrentUserRoles();
  const allowed = roles.some((role) => allowedRoles.includes(role));

  if (!allowed) {
    throw redirect({ to: fallbackPath });
  }

  return { user, roles };
}