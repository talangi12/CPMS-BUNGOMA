import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AppHeader } from "@/components/AppHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronRight, FileSignature, Crown, ShieldCheck, Briefcase, UserCog, Users } from "lucide-react";
import { transitionContract, signContract } from "@/lib/contracts.functions";
import { useRoles } from "@/hooks/useRoles";

export const Route = createFileRoute("/_authenticated/sign-off")({
  head: () => ({ meta: [{ title: "Sign-Off — Performance Contracts" }] }),
  component: SignOffPage,
});

type Report = {
  user_id: string; full_name: string; designation: string;
  department: string; directorate: string;
  contract_id?: string | null; contract_status?: string | null; signed_at?: string | null;
  workplan_id?: string | null; workplan_status?: string | null;
};
type Payload = { level: string; reports: Report[] };

const LEVEL_META: Record<string, { icon: React.ComponentType<{ className?: string }>; title: string; nextLabel: string }> = {
  governor: { icon: Crown, title: "Sign-Off Console — Governor", nextLabel: "CEC Members" },
  cec: { icon: ShieldCheck, title: "Sign-Off Console — CEC", nextLabel: "Chief Officers" },
  chief_officer: { icon: Briefcase, title: "Sign-Off Console — Chief Officer", nextLabel: "Directors" },
  director: { icon: UserCog, title: "Sign-Off Console — Director", nextLabel: "Supervisors" },
  supervisor: { icon: Users, title: "Sign-Off Console — Supervisor", nextLabel: "Assigned Employees" },
  none: { icon: FileSignature, title: "Sign-Off Console", nextLabel: "Reports" },
};

function SignOffPage() {
  const { user } = Route.useRouteContext();
  const { data: roles } = useRoles(user.id);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [selected, setSelected] = useState<Report | null>(null);
  const [contract, setContract] = useState<Record<string, unknown> | null>(null);
  const [objectives, setObjectives] = useState<Record<string, unknown>[]>([]);
  const [signName, setSignName] = useState("");
  const [signPosition, setSignPosition] = useState("");
  const [comment, setComment] = useState("");

  const _transition = useServerFn(transitionContract);
  const _sign = useServerFn(signContract);

  useEffect(() => {
    supabase.rpc("hierarchy_reports", { _actor: user.id }).then(({ data }) => {
      if (data) setPayload(data as unknown as Payload);
    });
  }, [user.id]);

  const openContract = async (r: Report) => {
    setSelected(r);
    setContract(null);
    setObjectives([]);
    if (!r.contract_id) return;
    const [{ data: c }, { data: objs }] = await Promise.all([
      supabase.from("performance_contracts").select("*").eq("id", r.contract_id).maybeSingle(),
      supabase.from("contract_objectives").select("*").eq("contract_id", r.contract_id).order("sort_order"),
    ]);
    setContract(c ? (c as unknown as Record<string, unknown>) : null);
    setObjectives((objs ?? []) as unknown as Record<string, unknown>[]);
  };

  const approve = async () => {
    if (!selected?.contract_id) return;
    try {
      await _transition({ data: { id: selected.contract_id, to: "approved", comment } });
      toast.success("Contract approved. Now sign to lock it.");
      openContract(selected);
    } catch (e) { toast.error((e as Error).message); }
  };
  const returnForAmendment = async () => {
    if (!selected?.contract_id) return;
    if (!comment.trim()) { toast.error("Add a comment describing what to amend."); return; }
    try {
      await _transition({ data: { id: selected.contract_id, to: "returned_for_amendment", comment } });
      toast.success("Returned for correction");
      openContract(selected);
    } catch (e) { toast.error((e as Error).message); }
  };
  const sign = async () => {
    if (!selected?.contract_id || !signName.trim()) { toast.error("Type your name to sign."); return; }
    try {
      await _sign({ data: { id: selected.contract_id, typed_name: signName, position: signPosition, comment } });
      toast.success("Senior Officer signature applied — awaiting Contract Owner signature");
      supabase.rpc("hierarchy_reports", { _actor: user.id }).then(({ data }) => data && setPayload(data as unknown as Payload));
      openContract(selected);
    } catch (e) { toast.error((e as Error).message); }
  };

  const level =
    payload?.level && payload.level !== "none"
      ? payload.level
      : roles?.includes("governor")
        ? "governor"
        : roles?.includes("cec")
          ? "cec"
          : roles?.includes("chief_officer")
            ? "chief_officer"
            : roles?.includes("director")
              ? "director"
              : roles?.includes("supervisor")
                ? "supervisor"
                : "none";
  const meta = LEVEL_META[level] ?? LEVEL_META.none;
  const Icon = meta.icon;

  const isSupervisorLevel = level === "supervisor";
  const status = contract ? String((contract as { status?: string }).status ?? "") : "";
  const canApprove = contract && ["submitted", "under_review", "resubmitted", "negotiation"].includes(status);
  const canSign = contract && !["signed", "locked"].includes(status);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader authenticated userId={user.id} />
      <main className="max-w-7xl mx-auto p-6 space-y-6">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-primary flex items-center gap-2">
            <Icon className="h-3.5 w-3.5" /> Hierarchical Sign-Off
          </div>
          <h1 className="font-display text-3xl font-bold">{meta.title}</h1>
          <p className="text-sm text-muted-foreground">
            You see only the officers immediately below you in the hierarchy. Select one to open their contract, review objectives and targets, approve or return for correction, then digitally sign.
          </p>
        </div>

        {!roles || roles.length === 0 ? null : level === "none" ? (
          <Card><CardContent className="pt-6 text-sm text-muted-foreground">
            You are not currently assigned an approving role (Governor, CEC, Chief Officer, Director or Supervisor).
          </CardContent></Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
            {/* Reports list */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{meta.nextLabel}</CardTitle>
                <p className="text-xs text-muted-foreground">Click a name to review their {isSupervisorLevel ? "workplan" : "Performance Contract"}.</p>
              </CardHeader>
              <CardContent className="space-y-2 max-h-[70vh] overflow-y-auto">
                {(payload?.reports ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground">No direct reports found. If this is unexpected, contact your system administrator to assign the correct role and department.</p>
                )}
                {(payload?.reports ?? []).map((r) => {
                  const status = isSupervisorLevel ? r.workplan_status : r.contract_status;
                  const done = ["signed", "locked", "approved", "completed"].includes(String(status ?? ""));
                  const active = selected?.user_id === r.user_id;
                  return (
                    <button
                      key={r.user_id}
                      onClick={() => openContract(r)}
                      className={`w-full text-left rounded-md border p-3 hover:bg-muted transition-colors ${active ? "border-primary bg-primary/5" : "border-border"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium text-sm">{r.full_name}</div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="text-[11px] text-muted-foreground">{r.designation}</div>
                      <div className="text-[11px] text-muted-foreground">{r.department}{r.directorate ? ` · ${r.directorate}` : ""}</div>
                      <div className="mt-1">
                        <Badge variant={done ? "default" : "secondary"} className="text-[10px]">
                          {status ? String(status).replace(/_/g, " ") : (isSupervisorLevel ? "no workplan" : "no contract")}
                        </Badge>
                      </div>
                    </button>
                  );
                })}
              </CardContent>
            </Card>

            {/* Review panel */}
            <div className="space-y-4">
              {!selected ? (
                <Card><CardContent className="pt-6 text-sm text-muted-foreground">Select an officer to load their contract.</CardContent></Card>
              ) : isSupervisorLevel ? (
                <Card>
                  <CardHeader><CardTitle className="text-base">{selected.full_name} — Workplan Review</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm">{selected.designation} · {selected.department}{selected.directorate ? ` · ${selected.directorate}` : ""}</p>
                    <p className="text-xs text-muted-foreground">Open the employee's assigned workplan, targets, progress and self-appraisal to review before approval.</p>
                    <div className="flex gap-2">
                      <Link to="/workplans"><Button size="sm">Open Workplans</Button></Link>
                      <Link to="/supervisor/inbox"><Button size="sm" variant="outline">Open Supervisor Inbox</Button></Link>
                    </div>
                  </CardContent>
                </Card>
              ) : !selected.contract_id ? (
                <Card><CardContent className="pt-6 text-sm text-muted-foreground">This officer has not yet created a Performance Contract. Approval will unlock once they submit it.</CardContent></Card>
              ) : (
                <>
                  <Card>
                    <CardHeader className="pb-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <CardTitle className="text-base">{selected.full_name} — Performance Contract</CardTitle>
                        <Badge>{String((contract as { status?: string })?.status ?? "loading…").replace(/_/g, " ")}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{selected.designation} · {selected.department}{selected.directorate ? ` · ${selected.directorate}` : ""}</p>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      {(["vision_statement","mission_statement","strategic_objectives","commitments_and_obligations"] as const).map((k) => {
                        const v = (contract as Record<string, string | null> | null)?.[k];
                        if (!v) return null;
                        return (
                          <div key={k}>
                            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{k.replace(/_/g, " ")}</div>
                            <div className="whitespace-pre-wrap">{v}</div>
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-base">Performance Matrix — Targets</CardTitle></CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Target</TableHead>
                            <TableHead className="w-24">Unit</TableHead>
                            <TableHead className="w-20">Weight</TableHead>
                            <TableHead className="w-32">Type</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {objectives.map((o) => {
                            const r = o as Record<string, string | number | null>;
                            return (
                              <TableRow key={String(r.id)}>
                                <TableCell className="text-xs">{String(r.objective ?? r.target ?? "")}</TableCell>
                                <TableCell className="text-xs">{String(r.unit ?? "")}</TableCell>
                                <TableCell className="text-xs">{Number(r.weight ?? 0)}</TableCell>
                                <TableCell className="text-xs">{String(r.type ?? "")}</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-base">Comments &amp; Actions</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                      <Textarea placeholder="Comment (required when returning for correction)" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} />
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={approve} disabled={!canApprove}>Approve</Button>
                        <Button size="sm" variant="outline" onClick={returnForAmendment} disabled={!canApprove}>Return for correction</Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 pt-2 border-t">
                        <Input placeholder="Your full name (typed signature)" value={signName} onChange={(e) => setSignName(e.target.value)} />
                        <Input placeholder="Your position" value={signPosition} onChange={(e) => setSignPosition(e.target.value)} />
                      </div>
                      <Button size="sm" onClick={sign} disabled={!canSign}>
                        <FileSignature className="h-3.5 w-3.5 mr-1.5" /> Digitally sign &amp; lock
                      </Button>
                      <p className="text-[11px] text-muted-foreground">
                        Signing is enabled once a contract exists. Hierarchy is still maintained: the current approving officer signs in order, and this action locks the contract at this level.
                      </p>
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}


