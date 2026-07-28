import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock, Crown, ShieldCheck, Briefcase, ClipboardList, UserCog, Users } from "lucide-react";

type Stage = {
  key: string;
  label: string;
  message: string;
  status: "complete" | "pending";
  signer?: string | null;
  position?: string | null;
  department?: string | null;
  directorate?: string | null;
  signature?: string | null;
  signed_at?: string | null;
};
type Payload = {
  department: string | null;
  directorate: string | null;
  ready_for_appraisal: boolean;
  stages: Stage[];
};

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  governor: Crown,
  cec: ShieldCheck,
  chief_officer: Briefcase,
  director: UserCog,
  supervisor: Users,
  workplan: ClipboardList,
};

export function ContractSignoffTracker({ userId }: { userId: string }) {
  const [data, setData] = useState<Payload | null>(null);

  useEffect(() => {
    if (!userId) return;
    supabase.rpc("department_signoff_status", { _uid: userId }).then(({ data }) => {
      if (data) setData(data as unknown as Payload);
    });
  }, [userId]);

  if (!data) return null;

  return (
    <Card>
      <CardHeader className="pb-3 border-b">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-lg font-display">Performance Contract Approval &amp; Sign-Off Status</CardTitle>
          <Badge variant={data.ready_for_appraisal ? "default" : "secondary"} className="text-xs">
            {data.ready_for_appraisal ? "Ready — supervisor approved" : "Awaiting hierarchical sign-off"}
          </Badge>
        </div>
        {data.department && (
          <p className="text-xs text-muted-foreground mt-1">
            Department: <span className="font-medium text-foreground">{data.department}</span>
            {data.directorate ? <> · Directorate: <span className="font-medium text-foreground">{data.directorate}</span></> : null}
          </p>
        )}
        <p className="text-xs text-muted-foreground mt-1">
          The complete approval chain from the Governor down to your workplan. Each stage must be completed before the next.
        </p>
      </CardHeader>
      <CardContent className="pt-5">
        <ol className="relative border-l-2 border-border ml-3 space-y-5">
          {data.stages.map((s, idx) => {
            const Icon = ICONS[s.key] ?? CheckCircle2;
            const done = s.status === "complete";
            const dt = s.signed_at ? new Date(s.signed_at) : null;
            return (
              <li key={s.key} className="ml-6 relative">
                <span
                  className={`absolute -left-[34px] flex h-7 w-7 items-center justify-center rounded-full ring-4 ring-background ${
                    done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                  }`}
                  aria-hidden
                >
                  {done ? <CheckCircle2 className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                </span>
                <div className="flex flex-wrap items-baseline gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <h4 className={`font-semibold text-sm ${done ? "text-foreground" : "text-muted-foreground"}`}>
                    Step {idx + 1}: {s.label}
                  </h4>
                  <Badge variant={done ? "outline" : "secondary"} className="text-[10px]">
                    {done ? "Approved" : "Pending"}
                  </Badge>
                </div>
                <p className={`mt-1 text-xs ${done ? "text-primary" : "text-muted-foreground"}`}>
                  {done ? `✅ ${s.message}` : s.message}
                </p>
                <div className="mt-2 grid gap-1 rounded-md border border-border/60 bg-muted/30 p-2.5 text-[11px]">
                  <div><span className="text-muted-foreground">Officer:</span> <span className="font-medium">{s.signer ?? "—"}</span></div>
                  <div><span className="text-muted-foreground">Position:</span> {s.position ?? "—"}</div>
                  <div>
                    <span className="text-muted-foreground">Dept / Directorate:</span> {s.department ?? "—"}
                    {s.directorate ? ` · ${s.directorate}` : ""}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Status:</span>{" "}
                    <span className={done ? "text-primary font-medium" : "text-muted-foreground"}>
                      {done ? "Approved" : "Pending approval"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Date approved:</span>{" "}
                    {dt ? dt.toLocaleDateString() : "—"}
                    <span className="text-muted-foreground"> · Time:</span>{" "}
                    {dt ? dt.toLocaleTimeString() : "—"}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Digital signature:</span>{" "}
                    <span className={done ? "text-primary" : "text-muted-foreground"}>{s.signature ?? "—"}</span>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
