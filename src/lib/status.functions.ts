import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const statusEnum = z.enum(["active","archived","on_leave","suspended","transferred","retired","terminated"]);

export const changeEmployeeStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({
    employee_id: z.string().uuid(),
    new_status: statusEnum,
    reason: z.string().trim().min(3).max(500),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("change_employee_status", {
      _employee: data.employee_id,
      _new: data.new_status,
      _reason: data.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const contractAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({
    employee_id: z.string().uuid(),
    action: z.enum(["restore","renew","extend","terminate"]),
    new_end_date: z.string().optional().nullable(),
    reason: z.string().trim().min(3).max(500),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("contract_action", {
      _employee: data.employee_id,
      _action: data.action,
      _new_end: data.new_end_date as unknown as string,
      _reason: data.reason,
    } as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const runMaintenance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: arch } = await context.supabase.rpc("archive_expired_contracts");
    return { archived: arch ?? 0 };
  });
