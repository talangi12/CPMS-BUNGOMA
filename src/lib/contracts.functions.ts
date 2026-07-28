import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const LEVELS = ["governor", "cec", "chief_officer", "director", "supervisor"] as const;
const CATEGORIES = [
  "financial_stewardship",
  "service_delivery",
  "institutional_transformation",
  "core_mandate",
  "cross_cutting",
] as const;
const ENTITIES = ["county_government", "county_executive_board", "county_public_office"] as const;

export const createContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({
    level: z.enum(LEVELS),
    entity_type: z.enum(ENTITIES).optional(),
    fy_label: z.string().optional(),
    fy_start: z.string().optional(),
    fy_end: z.string().optional(),
    parent_contract_id: z.string().uuid().optional().nullable(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Gate: parent must be signed (unless top-of-chain)
    const { data: allowed } = await supabase.rpc("can_start_contract", { _owner: userId });
    if (!allowed) throw new Error("Your supervisor's Performance Contract must be signed first.");

    const { data: prof } = await supabase.from("profiles")
      .select("supervisor_id, department, directorate, full_name")
      .eq("id", userId).maybeSingle();

    const { data: row, error } = await supabase.from("performance_contracts").insert({
      owner_id: userId,
      level: data.level,
      entity_type: data.entity_type ?? "county_government",
      supervisor_id: prof?.supervisor_id ?? null,
      parent_contract_id: data.parent_contract_id ?? null,
      department: prof?.department ?? null,
      directorate: prof?.directorate ?? null,
      fy_label: data.fy_label ?? null,
      fy_start: data.fy_start ?? null,
      fy_end: data.fy_end ?? null,
      contract_duration_start: data.fy_start ?? null,
      contract_duration_end: data.fy_end ?? null,
      status: "draft",
    }).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

export const upsertObjective = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({
    id: z.string().uuid().optional(),
    contract_id: z.string().uuid(),
    category: z.enum(CATEGORIES),
    objective: z.string().min(2),
    indicator: z.string().optional().nullable(),
    target: z.string().optional().nullable(),
    weight: z.number().min(0).max(100).default(0),
    baseline: z.string().optional().nullable(),
    data_source: z.string().optional().nullable(),
    sort_order: z.number().int().default(0),
    unit: z.string().optional().nullable(),
    type: z.string().optional().nullable(),
    source: z.string().optional().nullable(),
    matrix_id: z.string().uuid().optional().nullable(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const payload = { ...data };
    if (payload.id) {
      const { error } = await supabase.from("contract_objectives").update(payload).eq("id", payload.id);
      if (error) throw new Error(error.message);
    } else {
      const { id: _drop, ...ins } = payload;
      const { error } = await supabase.from("contract_objectives").insert(ins);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });


export const deleteObjective = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("contract_objectives").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const transitionContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({
    id: z.string().uuid(),
    to: z.enum([
      "negotiation", "submitted", "under_review", "approved",
      "returned_for_amendment", "resubmitted", "signed", "locked", "archived",
    ]),
    comment: z.string().optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: c, error: cerr } = await supabase.from("performance_contracts")
      .select("*").eq("id", data.id).single();
    if (cerr) throw new Error(cerr.message);

    // Weight validation before submission/approval
    if (["submitted", "approved", "signed"].includes(data.to)) {
      const { data: objs } = await supabase.from("contract_objectives")
        .select("weight").eq("contract_id", data.id);
      const total = (objs ?? []).reduce((s, o) => s + Number(o.weight ?? 0), 0);
      if (Math.round(total) !== 100) {
        throw new Error(`Total weight must equal 100 (currently ${total.toFixed(1)}).`);
      }
    }

    // Authorization
    const isOwner = c.owner_id === userId;
    const isSupervisor = c.supervisor_id === userId;
    const isAdmin = !!(await supabase.rpc("has_role", { _user_id: userId, _role: "system_admin" })).data
                 || !!(await supabase.rpc("has_role", { _user_id: userId, _role: "super_admin" })).data;

    const allowedByOwner = ["negotiation", "submitted", "resubmitted"].includes(data.to);
    const allowedBySupervisor = ["under_review", "approved", "returned_for_amendment", "signed", "locked"].includes(data.to);

    if (!isAdmin) {
      if (allowedByOwner && !isOwner) throw new Error("Only the contract owner can perform this action");
      if (allowedBySupervisor && !isSupervisor) throw new Error("Only the reviewing supervisor can perform this action");
    }

    const patch = { status: data.to } as {
      status: typeof data.to; submitted_at?: string; approved_at?: string; approved_by?: string; return_reason?: string | null;
    };
    if (data.to === "submitted" || data.to === "resubmitted") patch.submitted_at = new Date().toISOString();
    if (data.to === "approved") { patch.approved_at = new Date().toISOString(); patch.approved_by = userId; }
    if (data.to === "returned_for_amendment") patch.return_reason = data.comment ?? null;

    const { error } = await supabase.from("performance_contracts").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);

    await supabase.from("contract_events").insert({
      contract_id: data.id, actor_id: userId,
      event_type: data.to, from_status: c.status, to_status: data.to, comment: data.comment ?? null,
    });
    return { ok: true };
  });

export const signContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({
    id: z.string().uuid(),
    typed_name: z.string().min(2),
    position: z.string().optional(),
    comment: z.string().optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: c, error } = await supabase.from("performance_contracts")
      .select("*").eq("id", data.id).single();
    if (error) throw new Error(error.message);
    if (c.supervisor_id !== userId) {
      const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "super_admin" });
      if (!isAdmin) throw new Error("Only the assigned Senior Officer (supervisor) may sign at this step");
    }
    if (c.status !== "approved") throw new Error("Contract must be approved before signing");

    // Prevent duplicate senior-officer sign
    const { data: existing } = await supabase.from("contract_signoffs")
      .select("id").eq("contract_id", data.id).eq("is_owner", false).maybeSingle();
    if (existing) throw new Error("The Senior Officer has already signed this contract");

    await supabase.from("contract_signoffs").insert({
      contract_id: data.id, signer_id: userId, signer_role: c.level,
      signer_name: data.typed_name, signer_position: data.position ?? null,
      comment: data.comment ?? null, is_owner: false,
    });
    // Move to 'signed' — locked only when the Contract Owner also signs.
    await supabase.from("performance_contracts").update({
      status: "signed", signed_at: new Date().toISOString(),
    }).eq("id", data.id);
    return { ok: true };
  });

export const signContractAsOwner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({
    id: z.string().uuid(),
    typed_name: z.string().min(2),
    position: z.string().optional(),
    comment: z.string().optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: c, error } = await supabase.from("performance_contracts")
      .select("*").eq("id", data.id).single();
    if (error) throw new Error(error.message);
    if (c.owner_id !== userId) {
      const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "super_admin" });
      if (!isAdmin) throw new Error("Only the Performance Contract Owner may sign this acknowledgment");
    }
    // Senior Officer must have signed first
    const { data: seniorSig } = await supabase.from("contract_signoffs")
      .select("id").eq("contract_id", data.id).eq("is_owner", false).maybeSingle();
    if (!seniorSig) throw new Error("The Senior Officer must sign the Performance Contract before the Owner can sign");

    const { data: ownerSig } = await supabase.from("contract_signoffs")
      .select("id").eq("contract_id", data.id).eq("is_owner", true).maybeSingle();
    if (ownerSig) throw new Error("The Contract Owner has already signed this contract");

    await supabase.from("contract_signoffs").insert({
      contract_id: data.id, signer_id: userId, signer_role: c.level,
      signer_name: data.typed_name, signer_position: data.position ?? null,
      comment: data.comment ?? null, is_owner: true,
    });
    // Fully signed → lock
    await supabase.from("performance_contracts").update({
      status: "locked", locked_at: new Date().toISOString(),
    }).eq("id", data.id);
    await supabase.from("contract_events").insert({
      contract_id: data.id, actor_id: userId,
      event_type: "locked", from_status: "signed", to_status: "locked",
      comment: "Both signatures applied; contract fully signed and locked.",
    });
    return { ok: true };
  });


export const reopenContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid(), reason: z.string().min(3) }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("reopen_contract", { _contract: data.id, _reason: data.reason });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
