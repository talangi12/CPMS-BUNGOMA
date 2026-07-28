import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { getPortalRouteForRoles } from "@/lib/authGuard";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });

    if (location.pathname !== "/change-password") {
      const { data: prof } = await supabase.from("profiles").select("must_change_password").eq("id", data.user.id).maybeSingle();
      if (prof?.must_change_password) throw redirect({ to: "/change-password" });
    }

    if (location.pathname === "/dashboard") {
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id);
      const portalPath = getPortalRouteForRoles((roles ?? []).map((row) => row.role));
      if (portalPath !== "/dashboard") {
        throw redirect({ to: portalPath });
      }
    }

    return { user: data.user };
  },
  component: () => <Outlet />,
});
