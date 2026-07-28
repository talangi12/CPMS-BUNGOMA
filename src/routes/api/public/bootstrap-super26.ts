import { createFileRoute } from "@tanstack/react-router";

// One-shot idempotent bootstrap for the super26 admin account.
// Public route (no auth) — only ever creates the single hard-coded email.
// Safe to keep around: subsequent calls just return { created: false }.
export const Route = createFileRoute("/api/public/bootstrap-super26")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const email = "super26@bungoma.go.ke";
        const password = "Da2th26!";
        const { data: list, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
        if (listErr) return Response.json({ error: listErr.message }, { status: 500 });
        const existing = list.users.find((u) => u.email?.toLowerCase() === email);
        if (existing) return Response.json({ created: false, id: existing.id, email });
        const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
          email, password, email_confirm: true,
          user_metadata: { full_name: "System Super Admin", designation: "System Administrator", department: "Administration" },
        });
        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ created: true, id: created.user?.id, email });
      },
      GET: async () => Response.json({ usage: "POST to bootstrap super26@bungoma.go.ke" }),
    },
  },
});
