import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Clock, FileSignature, PenLine, RefreshCw, CheckCircle2, XCircle, FilePlus, Circle } from "lucide-react";

type TimelineRow = {
  id: string;
  at: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  action: string;
  details: Record<string, unknown> | null;
};

const ACTION_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  appraisal_created: { label: "Appraisal created", icon: FilePlus, tone: "text-muted-foreground" },
  appraisal_status_changed: { label: "Status changed", icon: RefreshCw, tone: "text-primary" },
  employee_signed: { label: "Employee signed", icon: PenLine, tone: "text-primary" },
  supervisor_reviewed: { label: "Supervisor review completed", icon: FileSignature, tone: "text-primary" },
};

function describe(row: TimelineRow): { label: string; note?: string; icon: React.ComponentType<{ className?: string }>; tone: string } {
  const meta = ACTION_META[row.action];
  if (row.action === "appraisal_status_changed") {
    const d = row.details as { status?: string; reason?: string } | null;
    const status = d?.status ?? "updated";
    const isApproved = status === "approved";
    const isRejected = status === "rejected";
    return {
      label: `Marked ${status.replace(/_/g, " ")}`,
      note: d?.reason ?? undefined,
      icon: isApproved ? CheckCircle2 : isRejected ? XCircle : RefreshCw,
      tone: isApproved ? "text-primary" : isRejected ? "text-destructive" : "text-muted-foreground",
    };
  }
  return {
    label: meta?.label ?? row.action.replace(/_/g, " "),
    icon: meta?.icon ?? Circle,
    tone: meta?.tone ?? "text-muted-foreground",
  };
}

export function AppraisalTimeline({ appraisalId }: { appraisalId: string | null | undefined }) {
  const { data, isLoading } = useQuery({
    queryKey: ["appraisal-timeline", appraisalId],
    queryFn: async () => {
      if (!appraisalId) return [] as TimelineRow[];
      const { data, error } = await supabase.rpc("appraisal_timeline", { _appraisal_id: appraisalId });
      if (error) throw error;
      return (data ?? []) as TimelineRow[];
    },
    enabled: !!appraisalId,
    staleTime: 30_000,
  });

  if (!appraisalId) return null;

  return (
    <Card className="mt-6 p-6">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-primary" />
        <h2 className="font-display text-lg font-bold">Review timeline</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Every action taken on this appraisal — signatures, submissions, reviews and approvals — recorded in order.
      </p>

      {isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">Loading history…</p>
      ) : !data || data.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
          No activity yet. Actions will appear here as soon as you save, sign or submit this appraisal.
        </p>
      ) : (
        <ol className="relative mt-5 space-y-4 border-l border-border pl-6">
          {data.map((row) => {
            const { label, note, icon: Icon, tone } = describe(row);
            return (
              <li key={row.id} className="relative">
                <span className={`absolute -left-[31px] flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background ${tone}`}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-sm font-medium">{label}</div>
                  <div className="text-xs text-muted-foreground">{new Date(row.at).toLocaleString()}</div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {row.actor_name ?? row.actor_email ?? "System"}
                </div>
                {note && <div className="mt-1 rounded-md bg-muted/40 p-2 text-xs">{note}</div>}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
