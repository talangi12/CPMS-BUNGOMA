import { createFileRoute } from "@tanstack/react-router";

// Daily background job: monitor contract end dates, archive expired contracts,
// suspend access, and audit log every change. Triggered by pg_cron with the
// Supabase anon key as `apikey` header. Safe to call by hand for testing.

export const Route = createFileRoute("/api/public/hooks/contract-monitor")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Soft auth: require apikey header to match the project publishable key.
        const apikey = request.headers.get("apikey") ?? "";
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
        if (!expected || apikey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // 1) Archive expired contracts + suspend access (employee_status -> 'archived')
        const { data: contractResult, error: monErr } =
          await supabaseAdmin.rpc("monitor_contracts");
        if (monErr) {
          return new Response(JSON.stringify({ ok: false, stage: "monitor_contracts", error: monErr.message }),
            { status: 500, headers: { "content-type": "application/json" } });
        }

        // 2) Audit summary entry
        await supabaseAdmin.from("audit_logs").insert({
          action: "background_job_run",
          entity_type: "system",
          new_values: {
            job: "contract-monitor",
            contracts: contractResult,
            ran_at: new Date().toISOString(),
          },
        });

        return new Response(JSON.stringify({
          ok: true,
          contracts: contractResult,
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    },
  },
});
