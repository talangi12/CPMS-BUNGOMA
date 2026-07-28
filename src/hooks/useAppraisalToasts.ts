import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

type AppraisalRow = {
  id: string;
  employee_id: string | null;
  chosen_supervisor_id: string | null;
  status: string | null;
  period: string | null;
  rejection_reason: string | null;
};

/**
 * Subscribes to realtime changes on `appraisals` and `notifications` and
 * surfaces role-appropriate toasts the moment a status changes.
 * Mount once per authenticated session (in AppHeader).
 */
export function useAppraisalToasts(userId?: string) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`toasts-${userId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "appraisals" },
        (payload) => {
          const n = payload.new as AppraisalRow;
          const o = (payload.old ?? {}) as Partial<AppraisalRow>;
          if (!n || !n.id) return;

          const involved =
            n.employee_id === userId ||
            n.chosen_supervisor_id === userId;
          if (!involved) return;

          const key = `${n.id}:${n.status}`;
          if (seen.current.has(key)) return;
          seen.current.add(key);

          const open = () => navigate({ to: "/appraisal" });

          // Status transitions for the appraisee
          if (n.employee_id === userId && o.status !== n.status) {
            if (n.status === "approved") {
              toast.success("Targets approved", {
                description: `Your ${n.period ?? ""} appraisal was approved by your supervisor.`,
                action: { label: "View", onClick: open },
              });
            } else if (n.status === "rejected") {
              toast.warning("Returned for corrections", {
                description: n.rejection_reason || "Your supervisor requested changes. Please revise and resubmit.",
                action: { label: "Open", onClick: open },
              });
            }
          }

          // Supervisor receives a new submission
          if (n.chosen_supervisor_id === userId && o.status !== "submitted" && n.status === "submitted") {
            toast("New appraisal awaiting your review", {
              description: `${n.period ?? "Appraisal"} submitted for your review.`,
              action: { label: "Review", onClick: () => navigate({ to: "/supervisor/inbox" }) },
            });
          }

          qc.invalidateQueries({ queryKey: ["dashboard", userId] });
          qc.invalidateQueries({ queryKey: ["dept-progress", userId] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, navigate, qc]);
}
