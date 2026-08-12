import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHash } from "crypto";
import { dispatchEmail } from "./notify.functions";

function hashCode(c: string) {
  return createHash("sha256").update(c).digest("hex");
}

// Step 1 — request a reset OTP. Accepts either National ID or Personal Number.
// Mocks email + SMS delivery (logged in notification_log; code returned for demo).
export const requestPasswordResetOtp = createServerFn({ method: "POST" })
  .inputValidator((i) =>
    z.object({ identifier: z.string().trim().min(3).max(40) }).parse(i),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin.rpc("resolve_identifier", { _identifier: data.identifier });
    const prof = Array.isArray(rows) ? rows[0] : null;
    if (!prof) throw new Error("No employee found with that identifier.");
    if (prof.employee_status === "archived" || prof.employee_status === "terminated") {
      throw new Error(`Account ${prof.employee_status}. Contact your administrator.`);
    }

    // Rate limit: max 3 in 10 min for this identifier/purpose
    const { count } = await supabaseAdmin
      .from("otp_codes")
      .select("id", { count: "exact", head: true })
      .eq("id_number", data.identifier)
      .eq("purpose", "reset")
      .gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString());
    if ((count ?? 0) >= 3) throw new Error("Too many reset requests. Wait 10 minutes.");

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires_at = new Date(Date.now() + 5 * 60_000).toISOString();

    await supabaseAdmin.from("otp_codes").insert({
      user_id: prof.user_id,
      id_number: data.identifier,
      phone_number: prof.phone_number ?? "",
      code_hash: hashCode(code),
      expires_at,
      purpose: "reset",
    });

    // Send password-reset email via email provider; SMS remains logged as a fallback.
    const phoneMasked = prof.phone_number ? prof.phone_number.replace(/.(?=.{4})/g, "•") : "—";
    const emailMasked = prof.personal_email ? prof.personal_email.replace(/(.).+(@.+)/, "$1•••$2") : "—";
    const body = `Bungoma CPMS — password reset code: ${code}. Expires in 5 minutes.`;

    if (prof.personal_email) {
      try {
        await dispatchEmail({
          to: prof.personal_email,
          to_user_id: prof.user_id,
          event_type: "password_reset_otp",
          subject: "Password reset code — Bungoma CPMS",
          html: `Dear ${prof.full_name ?? "Officer"},<br><br>Your password reset code is <strong>${code}</strong>. It expires in 5 minutes.`,
          related_employee_id: prof.user_id,
        });
      } catch {
        // audit already logged by dispatchEmail
      }
    } else {
      await supabaseAdmin.from("notification_log").insert({
        channel: "email", recipient: prof.personal_email ?? "mock@local",
        recipient_user_id: prof.user_id, event_type: "password_reset_otp",
        subject: "Password reset code — Bungoma CPMS", body,
        status: "mocked", provider: "none", sent_at: new Date().toISOString(),
      });
    }

    await supabaseAdmin.from("notification_log").insert({
      channel: "sms", recipient: prof.phone_number ?? "mock",
      recipient_user_id: prof.user_id, event_type: "password_reset_otp",
      subject: "Password reset", body,
      status: "mocked", provider: "none", sent_at: new Date().toISOString(),
    });

    await supabaseAdmin.rpc("log_audit", {
      _action: "password_reset_requested",
      _entity_type: "auth.users",
      _entity_id: prof.user_id,
      _old: null,
      _new: { phone_tail: (prof.phone_number ?? "").slice(-4) },
    });

    return {
      ok: true,
      mock_code: code,
      expires_at,
      sent_to_email_masked: emailMasked,
      sent_to_phone_masked: phoneMasked,
    };
  });

// Step 2 — verify OTP & set a new password atomically.
export const confirmPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((i) =>
    z.object({
      identifier: z.string().trim().min(3).max(40),
      code: z.string().trim().length(6),
      new_password: z.string().min(8).max(128)
        .regex(/[A-Z]/, "Must contain an uppercase letter")
        .regex(/[a-z]/, "Must contain a lowercase letter")
        .regex(/\d/, "Must contain a digit")
        .regex(/[^A-Za-z0-9]/, "Must contain a symbol"),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("otp_codes")
      .select("*")
      .eq("id_number", data.identifier)
      .eq("purpose", "reset")
      .is("consumed_at", null)
      .order("created_at", { ascending: false })
      .limit(1);
    const row = rows?.[0];
    if (!row) throw new Error("No active reset code. Request a new one.");
    if (new Date(row.expires_at) < new Date()) throw new Error("Code expired. Request a new one.");
    if (row.attempts >= row.max_attempts) throw new Error("Too many incorrect attempts. Request a new code.");
    if (hashCode(data.code) !== row.code_hash) {
      await supabaseAdmin.from("otp_codes").update({ attempts: row.attempts + 1 }).eq("id", row.id);
      throw new Error(`Incorrect code. ${row.max_attempts - row.attempts - 1} attempt(s) remaining.`);
    }
    if (!row.user_id) throw new Error("Profile missing — contact administrator.");

    const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(row.user_id, { password: data.new_password });
    if (updErr) throw new Error(updErr.message);

    await supabaseAdmin.from("otp_codes").update({ consumed_at: new Date().toISOString() }).eq("id", row.id);
    await supabaseAdmin.from("profiles").update({ must_change_password: false }).eq("id", row.user_id);
    await supabaseAdmin.rpc("log_audit", {
      _action: "password_reset_completed",
      _entity_type: "auth.users",
      _entity_id: row.user_id,
      _old: null, _new: null,
    });

    return { ok: true };
  });
