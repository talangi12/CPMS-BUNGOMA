import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AppRole =
  | "employee"
  | "supervisor"
  | "external_assessor"
  | "hr"
  | "system_admin"
  | "super_admin"
  | "appeals_committee"
  | "governor"
  | "cec"
  | "chief_officer"
  | "director"
  | "dept_admin"
  | "admin"
  | "county_administrator"
  | "department_head";



export const ROLE_LABELS: Record<AppRole, string> = {
  employee: "Appraisee",
  supervisor: "Supervisor",
  hr: "HR Officer",
  system_admin: "System Admin",
  super_admin: "Super Admin",
  appeals_committee: "Appeals Committee",
  governor: "Governor",
  cec: "County Executive Committee Member",
  chief_officer: "Chief Officer",
  director: "Director",
  dept_admin: "Departmental Administrator",
  admin: "Administrator",
  county_administrator: "County Administrator",
  department_head: "Department Head",
};

export const ROLE_RESPONSIBILITIES: Record<AppRole, string> = {
  employee: "Set targets, sign agreements, complete self-assessment and view your appraisals.",
  supervisor: "Review submitted targets and appraisals, approve or reject with comments, sign agreements and provide mid-year feedback.",
  hr: "Oversee appraisal cycles county-wide, monitor compliance and view all appraisals.",
  system_admin: "Manage users, assign roles, configure cycles and maintain system configuration.",
  super_admin: "Full administrative authority across the CPMS, including HR, system and audit operations.",
  appeals_committee: "Review and rule on appraisal appeals submitted by employees.",
  governor: "Sign and authorise the annual appraisal cycle county-wide; imports CECs.",
  cec: "Authorise the cycle for the assigned department; imports Chief Officers.",
  chief_officer: "Authorise the appraisal cycle for the assigned department; imports Directors.",
  director: "Endorse the appraisal cycle for the assigned directorate; imports employees and supervisors.",
  dept_admin: "Manage the departmental Performance Matrix — add, edit, reorder, activate and deactivate performance targets. Cannot edit officers' Performance Contracts.",
  admin: "",
  county_administrator: "",
  department_head: "",
  external_assessor: "Review appraisal progress county-wide and support independent oversight with read-only access.",
};


export type UserRoleRow = { role: AppRole; department: string | null };

export function useRoles(userId?: string) {
  return useQuery({
    queryKey: ["roles", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId!);
      if (error) throw error;
      return (data ?? []).map((r) => r.role as AppRole);
    },
  });
}

export function useRoleRows(userId?: string) {
  return useQuery({
    queryKey: ["role-rows", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role, department")
        .eq("user_id", userId!);
      if (error) throw error;
      return (data ?? []) as UserRoleRow[];
    },
  });
}

export function hasAnyRole(roles: AppRole[] | undefined, target: AppRole[]) {
  if (!roles) return false;
  return roles.some((r) => target.includes(r));
}
      export function hasAdminAccess(
  roles: Array<string | AppRole | null | undefined> | undefined | null
) {
  if (!roles?.length) return false;

  const adminRoles = new Set([
    "system_admin",
    "super_admin",
    "hr",
    "governor",
    "cec",
    "chief_officer",
    "director",
    "appeals_committee",
    "dept_admin",
    "admin",
    "county_administrator",
    "department_head",
  ]);

  return roles.some((role) =>
    adminRoles.has(String(role ?? "").trim().toLowerCase())
);
}

export const DEPARTMENT_SCOPED_ROLES: AppRole[] = ["chief_officer", "director", "supervisor", "employee"];
