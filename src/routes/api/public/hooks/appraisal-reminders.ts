import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/api/public/hooks/appraisal-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.replace("Bearer ", "") || request.headers.get("apikey") || "";
        if (!token) {
          return new Response(JSON.stringify({ error: "Missing apikey" }), {
            status: 401, headers: { "content-type": "application/json" },
          });
        }
        const url = process.env.SUPABASE_URL!;
        const client = createClient(url, token, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const { data, error } = await client.rpc("process_appraisal_reminders");
        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500, headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ ok: true, result: data }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
