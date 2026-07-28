import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHash } from "crypto";

function hashCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

function normalisePhone(p: string) {
  return p.replace(/\D/g, "").replace(/^0/, "254").replace(/^2540/, "254");
}

// Request an OTP — verifies ID + phone, creates code, returns the code (mock SMS).
export const requestOtp = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({
    id_number: z.string().trim().min(3).max(20),
    phone: z.string().trim().min(7).max(20),
  }).parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("id, email, phone_number, employee_status, employment_type, contract_end_date, full_name")
      .eq("id_number", data.id_number as string)
      .maybeSingle();
    if (!prof) throw new Error("No employee found with that National ID.");

    const stored = prof.phone_number ? normalisePhone(prof.phone_number) : "";
    const given = normalisePhone(data.phone);
    if (!stored || stored !== given) throw new Error("Phone number does not match our records.");

    if (prof.employee_status === "archived" || prof.employee_status === "terminated" || prof.employee_status === "retired") {
      throw new Error(`Account ${prof.employee_status}. Contact your administrator.`);
    }
    if (prof.employee_status === "suspended") {
      throw new Error("Account suspended. Contact System Administrator.");
    }
    if (prof.employment_type === "contract" && prof.contract_end_date && new Date(prof.contract_end_date) < new Date()) {
      throw new Error("Your contract has ended. Sign-in is disabled.");
    }

    // Rate limit: max 3 OTP requests in last 10 minutes
    const { count } = await supabaseAdmin
      .from("otp_codes")
      .select("id", { count: "exact", head: true })
      .eq("id_number", data.id_number as string)
      .gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString());
    if ((count ?? 0) >= 3) throw new Error("Too many OTP requests. Wait 10 minutes.");

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires_at = new Date(Date.now() + 5 * 60_000).toISOString();

    await supabaseAdmin.from("otp_codes").insert({
      user_id: prof.id,
      id_number: data.id_number,
      phone_number: given,
      code_hash: hashCode(code),
      expires_at,
    });
    await supabaseAdmin.rpc("log_audit", {
      _action: "otp_requested",
      _entity_type: "auth.users",
      _entity_id: prof.id,
      _old: null,
      _new: { phone: given.slice(-4) },
    });

    // MOCK SMS — code returned in payload until a real gateway is wired.
    return { ok: true, mock_code: code, expires_at, full_name: prof.full_name };
  });

// Verify OTP and return a magic-link token_hash the client can exchange for a session.
export const verifyOtp = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({
    id_number: z.string().trim().min(3).max(20),
    code: z.string().trim().length(6),
  }).parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows } = await supabaseAdmin
      .from("otp_codes")
      .select("*")
      .eq("id_number", data.id_number as string)
      .is("consumed_at", null)
      .order("created_at", { ascending: false })
      .limit(1);
    const row = rows?.[0];
    if (!row) throw new Error("No active OTP. Request a new one.");
    if (new Date(row.expires_at) < new Date()) throw new Error("OTP expired. Request a new one.");
    if (row.attempts >= row.max_attempts) throw new Error("Too many incorrect attempts. Request a new OTP.");

    if (hashCode(data.code) !== row.code_hash) {
      await supabaseAdmin.from("otp_codes").update({ attempts: row.attempts + 1 }).eq("id", row.id);
      await supabaseAdmin.rpc("log_audit", {
        _action: "otp_failed", _entity_type: "auth.users", _entity_id: row.user_id ?? undefined,
        _old: null, _new: { attempt: row.attempts + 1 },
      });
      throw new Error(`Incorrect code. ${row.max_attempts - row.attempts - 1} attempt(s) remaining.`);
    }

    await supabaseAdmin.from("otp_codes").update({ consumed_at: new Date().toISOString() }).eq("id", row.id);

    const { data: prof } = await supabaseAdmin
      .from("profiles").select("email").eq("id_number", data.id_number as string).maybeSingle();
    if (!prof?.email) throw new Error("Profile email missing.");

    const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: prof.email,
    });
    if (error || !link.properties?.hashed_token) throw new Error(error?.message ?? "Failed to issue session.");

    await supabaseAdmin.rpc("log_audit", {
      _action: "otp_verified", _entity_type: "auth.users", _entity_id: row.user_id ?? undefined, _old: null, _new: null,
    });

    return { token_hash: link.properties.hashed_token, email: prof.email };
  });
