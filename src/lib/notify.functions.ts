import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Lightweight email notification dispatcher.
// Uses Resend via the Lovable connector gateway when LOVABLE_API_KEY and
// RESEND_API_KEY are present, otherwise logs the attempt as "mocked" so the
// audit trail still captures who/what/when.

type SendArgs = {
  to: string;
  to_user_id?: string | null;
  event_type: string;
  subject: string;
  html: string;
  related_appraisal_id?: string | null;
  related_employee_id?: string | null;
};

export async function dispatchEmail(args: SendArgs) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const postmarkKey = process.env.POSTMARK_API_KEY;
  const lovelyKey = process.env.LOVABLE_API_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const fromAddr = process.env.NOTIFY_FROM_EMAIL || "Bungoma county gvt <noreply@bungoma.go.ke>";

  const baseRow = {
    channel: "email",
    recipient: args.to,
    recipient_user_id: args.to_user_id ?? null,
    event_type: args.event_type,
    subject: args.subject,
    body: args.html,
    related_appraisal_id: args.related_appraisal_id ?? null,
    related_employee_id: args.related_employee_id ?? null,
  };

  if (postmarkKey) {
    try {
      const resp = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "X-Postmark-Server-Token": postmarkKey,
        },
        body: JSON.stringify({
          From: fromAddr,
          To: args.to,
          Subject: args.subject,
          HtmlBody: args.html,
        }),
      });
      const json = await resp.json();
      const ok = resp.ok && json?.ErrorCode === 0;
      await supabaseAdmin.from("notification_log").insert({
        ...baseRow,
        status: ok ? "sent" : "failed",
        provider: "postmark",
        provider_response: JSON.stringify(json).slice(0, 2000),
        error: ok ? null : `HTTP ${resp.status} ${json?.Message ?? ""}`,
        sent_at: ok ? new Date().toISOString() : null,
      });
      await supabaseAdmin.from("audit_logs").insert({
        action: ok ? "notification_sent" : "notification_failed",
        entity_type: "notification_log",
        new_values: { event_type: args.event_type, to: args.to, subject: args.subject, status: resp.status },
      });
      return { sent: ok, provider: "postmark" as const, response: json };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      await supabaseAdmin.from("notification_log").insert({ ...baseRow, status: "failed", provider: "postmark", error: err });
      await supabaseAdmin.from("audit_logs").insert({
        action: "notification_failed", entity_type: "notification_log",
        new_values: { event_type: args.event_type, to: args.to, error: err },
      });
      return { sent: false, error: err };
    }
  }

  if (!lovelyKey || !resendKey) {
    await supabaseAdmin.from("notification_log").insert({
      ...baseRow,
      status: "mocked",
      provider: "none",
      provider_response: "No email provider configured — logged for audit only.",
      sent_at: new Date().toISOString(),
    });
    await supabaseAdmin.from("audit_logs").insert({
      action: "notification_mocked", entity_type: "notification_log",
      new_values: { event_type: args.event_type, to: args.to, subject: args.subject },
    });
    return { sent: false, mocked: true };
  }

  try {
    const resp = await fetch("https://connector-gateway.lovable.dev/resend/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lovelyKey}`,
        "X-Connection-Api-Key": resendKey,
      },
      body: JSON.stringify({ from: fromAddr, to: [args.to], subject: args.subject, html: args.html }),
    });
    const txt = await resp.text();
    const ok = resp.ok;
    await supabaseAdmin.from("notification_log").insert({
      ...baseRow,
      status: ok ? "sent" : "failed",
      provider: "resend",
      provider_response: txt.slice(0, 2000),
      error: ok ? null : `HTTP ${resp.status}`,
      sent_at: ok ? new Date().toISOString() : null,
    });
    await supabaseAdmin.from("audit_logs").insert({
      action: ok ? "notification_sent" : "notification_failed",
      entity_type: "notification_log",
      new_values: { event_type: args.event_type, to: args.to, subject: args.subject, status: resp.status },
    });
    return { sent: ok };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    await supabaseAdmin.from("notification_log").insert({ ...baseRow, status: "failed", provider: "resend", error: err });
    await supabaseAdmin.from("audit_logs").insert({
      action: "notification_failed", entity_type: "notification_log",
      new_values: { event_type: args.event_type, to: args.to, error: err },
    });
    return { sent: false, error: err };
  }
}

const tmpl = {
  shell: (title: string, body: string) => `
    <div style="font-family:Inter,system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fffaf0;border:1px solid #e6dbc0;border-radius:12px;">
      <div style="font-family:Georgia,serif;font-size:20px;font-weight:700;color:#2d4a1f;border-bottom:2px solid #d4a017;padding-bottom:8px;margin-bottom:16px;">${title}</div>
      <div style="color:#1f1f1f;font-size:14px;line-height:1.55;">${body}</div>
      <div style="margin-top:24px;padding-top:12px;border-top:1px solid #e6dbc0;font-size:11px;color:#7a6a4a;">County Government of Bungoma — Employee Performance Management System</div>
    </div>`,
};

export const renderTemplate = (event: string, vars: Record<string, string>) => {
  switch (event) {
    case "appraisal_approved":
      return {
        subject: `Appraisal approved — ${vars.period ?? ""}`,
        html: tmpl.shell("Appraisal approved",
          `<p>Dear ${vars.name ?? "Officer"},</p><p>Your <b>${vars.period ?? ""}</b> performance appraisal has been approved by your supervisor.</p><p><strong>Score:</strong> ${vars.score ?? "Pending"}</p><p><strong>Rating:</strong> ${vars.rating ?? "Pending"}</p>`),
      };
    case "appraisal_rejected":
      return {
        subject: `Appraisal needs revision — ${vars.period ?? ""}`,
        html: tmpl.shell("Revision required",
          `<p>Dear ${vars.name ?? "Officer"},</p><p>Your supervisor has requested changes to your appraisal.</p><p><strong>Comments:</strong> ${vars.reason ?? "—"}</p>`),
      };
    case "appraisal_reopened":
      return {
        subject: `Appraisal reopened for edits — ${vars.period ?? ""}`,
        html: tmpl.shell("Appraisal reopened",
          `<p>Dear ${vars.name ?? "Officer"},</p><p>Your supervisor has reopened your appraisal for further edits.</p><p><strong>Reason:</strong> ${vars.reason ?? "—"}</p>`),
      };
    case "appraisal_submitted":
      return {
        subject: `Appraisal submitted — ${vars.period ?? ""}`,
        html: tmpl.shell("Appraisal submitted",
          `<p>Dear ${vars.name ?? "Officer"},</p><p>Your appraisal for <b>${vars.period ?? ""}</b> has been submitted to your supervisor and is now under review.</p>`),
      };
    case "password_reset_otp":
      return {
        subject: "Password reset code — Bungoma CPMS",
        html: tmpl.shell("Password reset code",
          `<p>Dear ${vars.name ?? "Officer"},</p><p>Your password reset code is <strong>${vars.code ?? "—"}</strong>. It expires in 5 minutes.</p>`),
      };
    case "cycle_opening":
      return {
        subject: `Appraisal cycle opened — ${vars.period ?? ""}`,
        html: tmpl.shell("Appraisal cycle opened",
          `<p>Dear ${vars.name ?? "Officer"},</p><p>A new appraisal cycle has opened for <b>${vars.period ?? ""}</b>. Please check your dashboard for details.</p>`),
      };
    default:
      return { subject: `Notification: ${event}`, html: tmpl.shell("Notification", `<p>${JSON.stringify(vars)}</p>`) };
  }
};

// Manual server fn admins can call to send a test email.
export const sendTestEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ to: z.string().email() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: ok } = (await context.supabase.rpc("is_admin_viewer", { _uid: context.userId })) as { data: boolean | null };
    if (!ok) throw new Error("Admin only");
    const t = renderTemplate("appraisal_approved", { name: "Test User", period: "2026" });
    return dispatchEmail({ to: data.to, event_type: "test_email", subject: t.subject, html: t.html });
  });

// Sync pending notifications -> emails (called by approval/return flows).
export const sendEventEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      event_type: z.string(),
      to_user_id: z.string().uuid(),
      vars: z.record(z.string(), z.string()).default({}),
      related_appraisal_id: z.string().uuid().optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile } = await supabaseAdmin
      .from("profiles").select("email, full_name").eq("id", data.to_user_id).maybeSingle();
    if (!profile?.email) return { sent: false, reason: "no_email" };
    const t = renderTemplate(data.event_type, { ...data.vars, name: profile.full_name ?? "" });
    return dispatchEmail({
      to: profile.email, to_user_id: data.to_user_id, event_type: data.event_type,
      subject: t.subject, html: t.html, related_appraisal_id: data.related_appraisal_id ?? null,
    });
  });
