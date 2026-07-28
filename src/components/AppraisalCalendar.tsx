import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, Loader2, FileSignature, Target, ClipboardCheck, CalendarClock } from "lucide-react";

type Stage = { key: string; label: string; date: string };
type Calendar = {
  fy_label: string | null;
  fy_start: string | null;
  fy_end: string | null;
  contract_status: string | null;
  appraisal_status: string | null;
  current_stage: string;
  stages: Stage[];
};

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  contract: FileSignature,
  target_setting: Target,
  supervisor_review: ClipboardCheck,
  q1: CalendarClock,
  q2_midyear: CalendarClock,
  q3: CalendarClock,
  q4_endyear: CalendarClock,
  closed: CheckCircle2,
};

export function AppraisalCalendar({ userId }: { userId: string }) {
  const [cal, setCal] = useState<Calendar | null>(null);

  useEffect(() => {
    if (!userId) return;
    supabase.rpc("appraisal_calendar", { _uid: userId }).then(({ data }) => {
      if (data) setCal(data as unknown as Calendar);
    });
  }, [userId]);

  if (!cal) return null;
  const currentIdx = cal.stages.findIndex((s) => s.key === cal.current_stage);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-lg">Appraisal Cycle Calendar {cal.fy_label ? `— ${cal.fy_label}` : ""}</CardTitle>
          <Badge variant="secondary" className="capitalize">
            Current stage: {cal.stages[currentIdx]?.label ?? cal.current_stage.replace(/_/g, " ")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <ol className="relative border-l border-border ml-3 space-y-4">
          {cal.stages.map((s, idx) => {
            const done = idx < currentIdx;
            const active = idx === currentIdx;
            const Icon = ICONS[s.key] ?? Circle;
            return (
              <li key={s.key} className="ml-6">
                <span
                  className={`absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-background ${
                    done ? "bg-primary text-primary-foreground" : active ? "bg-accent text-accent-foreground animate-pulse" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : active ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
                </span>
                <div className="flex flex-wrap items-baseline gap-2">
                  <h4 className={`font-medium ${active ? "text-foreground" : done ? "text-muted-foreground line-through" : "text-muted-foreground"}`}>{s.label}</h4>
                  <span className="text-xs text-muted-foreground">{s.date}</span>
                  {active && <Badge className="ml-1">In progress</Badge>}
                  {done && <Badge variant="outline" className="ml-1">Complete</Badge>}
                </div>
              </li>
            );
          })}
        </ol>
        {cal.current_stage === "contract" && (
          <p className="mt-4 text-sm text-muted-foreground">
            You can proceed with testing the appraisal cycle even if the Performance Contract is not fully completed. Open <a href="/contracts" className="underline">Performance Contract</a> if you want to continue working on it.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
