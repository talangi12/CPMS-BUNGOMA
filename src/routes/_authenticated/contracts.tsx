import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AppHeader } from "@/components/AppHeader";
import { Crown, ShieldCheck, Building2, FileSignature, CheckCircle2, Lock, Upload, Info, Image, X } from "lucide-react";
import { createContract, upsertObjective, deleteObjective, transitionContract, reopenContract, signContractAsOwner } from "@/lib/contracts.functions";
import { loadPerformanceMatrixState } from "@/lib/performance-matrix";

export const Route = createFileRoute("/_authenticated/contracts")({
  head: () => ({ meta: [{ title: "Performance Contracts — SPAS" }] }),
  component: ContractsPage,
});

type EntityType = "county_government" | "county_executive_board" | "county_public_office";

const ENTITY_META: Record<EntityType, { label: string; hierarchy: string[]; final: string; icon: React.ComponentType<{ className?: string }> }> = {
  county_government:      { label: "County Government",                  hierarchy: ["Governor","CEC Member","Chief Officer","Director","Supervisor","Employee Workplan"], final: "Governor",     icon: Crown },
  county_executive_board: { label: "County Executive Board",             hierarchy: ["CEC Member","Chief Officer","Director","Supervisor","Employee Workplan"],           final: "CEC Member",   icon: ShieldCheck },
  county_public_office:   { label: "County Public Office / Board (POV)", hierarchy: ["Chairperson","CEO / Secretary","Director","Supervisor","Employee Workplan"],        final: "Chairperson",  icon: Building2 },
};

type Contract = {
  id: string; owner_id: string; level: string; status: string; fy_label: string | null;
  supervisor_id: string | null; contract_number: string | null;
  entity_type: EntityType | null;
  vision_statement: string | null; mission_statement: string | null;
  strategic_objectives: string | null; commitments_and_obligations: string | null;
  reporting_requirements: string | null; statement_of_responsibility: string | null;
  statement_of_strategic_intent: string | null;
  contract_duration_start: string | null; contract_duration_end: string | null;
};
type Objective = {
  id: string; contract_id: string; category: string; objective: string;
  indicator: string | null; target: string | null; weight: number; sort_order: number;
  unit: string | null; type: string | null; source: string | null; matrix_id: string | null;
  current_status: string | null; achievement: string | null; achievement_pct: number | null;
};
type MatrixItem = {
  id: string; department: string; category: string; target: string;
  unit: string; weight: number; type: string; source: string | null;
  sort_order: number; is_active: boolean;
};
type SourceOption = { id: string; department: string; label: string; is_active: boolean };
type CategoryMeta = { category_key: string; label: string; recommended_weight: number; description: string | null; guidance: string | null };
type StatusOption = { id: string; label: string };

const STATUS_STEPS = ["draft", "negotiation", "submitted", "under_review", "approved", "signed", "locked"];

function ContractsPage() {
  const [userId, setUserId] = useState<string>("");
  const [matrixItems, setMatrixItems] = useState<MatrixItem[]>([]);
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [categories, setCategories] = useState<CategoryMeta[]>([]);
  const [statusOptions, setStatusOptions] = useState<StatusOption[]>([]);
  const [contract, setContract] = useState<Contract | null>(null);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [signoffs, setSignoffs] = useState<Array<{ id: string; is_owner: boolean; signer_name: string; signer_position: string | null; signed_at: string; signer_id: string; comment: string | null; signature_image_path?: string | null }>>([]);
  const [canStart, setCanStart] = useState<boolean>(false);
  const [entityChoice, setEntityChoice] = useState<EntityType>("county_government");
  const [loading, setLoading] = useState(true);
  const [ownerSignName, setOwnerSignName] = useState("");
  const [ownerSignPosition, setOwnerSignPosition] = useState("");
  const [ownerSignMode, setOwnerSignMode] = useState<"typed" | "image">("typed");
  const [ownerSignFile, setOwnerSignFile] = useState<File | null>(null);
  const [ownerSignPreview, setOwnerSignPreview] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);

  const _create = useServerFn(createContract);
  const _upsert = useServerFn(upsertObjective);
  const _delete = useServerFn(deleteObjective);
  const _transition = useServerFn(transitionContract);
  const _reopen = useServerFn(reopenContract);
  const _signOwner = useServerFn(signContractAsOwner);

  const load = async (uid: string) => {
    const { data: prof } = await supabase.from("profiles").select("department").eq("id", uid).maybeSingle();
    const { data: roleRows } = await supabase.from("user_roles").select("department").eq("user_id", uid);
    const dept = prof?.department ?? roleRows?.find((row) => row.department)?.department ?? "";
    const [{ data: cs }, { data: ok }] = await Promise.all([
      supabase.from("performance_contracts").select("*").eq("owner_id", uid).order("created_at", { ascending: false }).limit(1),
      supabase.rpc("can_start_contract", { _owner: uid }),
    ]);
    const { matrixRows, sourceRows, categories: categoryRows, statusRows } = await loadPerformanceMatrixState(supabase, dept, { includeInactive: false });
    setMatrixItems((matrixRows ?? []) as unknown as MatrixItem[]);
    setSources((sourceRows ?? []) as unknown as SourceOption[]);
    setCategories((categoryRows ?? []) as unknown as CategoryMeta[]);
    setStatusOptions((statusRows ?? []) as unknown as StatusOption[]);

    const c = (cs ?? [])[0] as Contract | undefined;
    setContract(c ?? null);
    setCanStart(!!ok);
    if (c) {
      const [{ data: objs }, { data: sigs }] = await Promise.all([
        supabase.from("contract_objectives").select("*").eq("contract_id", c.id).order("sort_order"),
        supabase.from("contract_signoffs").select("id, is_owner, signer_name, signer_position, signed_at, signer_id, comment, signature_image_path").eq("contract_id", c.id).order("signed_at"),
      ]);
      setObjectives((objs ?? []) as unknown as Objective[]);
      setSignoffs((sigs ?? []) as typeof signoffs);
    } else {
      setSignoffs([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) { setUserId(data.user.id); load(data.user.id); }
    });
  }, []);

  const totalWeight = objectives.reduce((s, o) => s + Number(o.weight ?? 0), 0);
  const locked = contract && ["signed", "locked"].includes(contract.status);
  const entity = (contract?.entity_type ?? entityChoice) as EntityType;
  const meta = ENTITY_META[entity];

  const handleCreate = async () => {
    try {
      const { data: rolesRows } = await supabase.from("user_roles").select("role").eq("user_id", userId);
      const roles = new Set((rolesRows ?? []).map((r) => r.role as string));
      const level = roles.has("governor") ? "governor"
        : roles.has("cec") ? "cec"
        : roles.has("chief_officer") ? "chief_officer"
        : roles.has("director") ? "director"
        : roles.has("supervisor") ? "supervisor"
        : null;
      if (!level) { toast.error("Only officers in the approval chain may prepare a Performance Contract."); return; }
      await _create({ data: { level, entity_type: entityChoice, fy_label: `FY ${new Date().getFullYear()}/${new Date().getFullYear() + 1}` } });
      toast.success("Performance Contract created");
      load(userId);
    } catch (e: unknown) { toast.error((e as Error).message); }
  };

  const handleSignFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!["image/png", "image/jpg", "image/jpeg"].includes(f.type) && !/\.(png|jpe?g)$/i.test(f.name)) {
      toast.error("Only PNG, JPG, or JPEG images are accepted"); return;
    }
    if (f.size > 10 * 1024 * 1024) { toast.error("File size must be under 10 MB"); return; }
    setOwnerSignFile(f);
    const reader = new FileReader();
    reader.onload = (ev) => setOwnerSignPreview(ev.target?.result as string);
    reader.readAsDataURL(f);
  };

  const handleOwnerSign = async () => {
    if (!contract) return;
    if (ownerSignMode === "typed" && !ownerSignName.trim()) { toast.error("Type your full name to apply your signature."); return; }
    if (ownerSignMode === "image" && !ownerSignFile) { toast.error("Upload a signature image."); return; }
    if (!ownerSignName.trim()) { toast.error("Enter your full name."); return; }
    setSigning(true);
    try {
      let signatureImagePath: string | undefined;
      if (ownerSignMode === "image" && ownerSignFile) {
        const path = `contracts/${contract.id}/${Date.now()}-signature.${ownerSignFile.name.split(".").pop()}`;
        const { error: upErr } = await supabase.storage.from("signatures").upload(path, ownerSignFile, { contentType: ownerSignFile.type, upsert: false });
        if (upErr) throw upErr;
        signatureImagePath = path;
      }
      // Sign via server function (passes typed name)
      await _signOwner({ data: { id: contract.id, typed_name: ownerSignName.trim(), position: ownerSignPosition.trim() || undefined } });
      // If there's an image, update the signoff record with the path
      if (signatureImagePath) {
        const { data: sigs } = await supabase.from("contract_signoffs").select("id").eq("contract_id", contract.id).eq("is_owner", true).order("signed_at", { ascending: false }).limit(1);
        if (sigs?.[0]) {
          await supabase.from("contract_signoffs").update({ signature_image_path: signatureImagePath }).eq("id", sigs[0].id);
        }
      }
      toast.success("Performance Contract fully signed and locked");
      setOwnerSignName(""); setOwnerSignPosition(""); setOwnerSignFile(null); setOwnerSignPreview(null);
      load(userId);
    } catch (e) { toast.error((e as Error).message); }
    finally { setSigning(false); }
  };

  const saveSections = async () => {
    if (!contract) return;
    const { error } = await supabase.from("performance_contracts").update({
      vision_statement: contract.vision_statement, mission_statement: contract.mission_statement,
      strategic_objectives: contract.strategic_objectives, statement_of_responsibility: contract.statement_of_responsibility,
      statement_of_strategic_intent: contract.statement_of_strategic_intent,
      commitments_and_obligations: contract.commitments_and_obligations,
      reporting_requirements: contract.reporting_requirements,
      contract_duration_start: contract.contract_duration_start, contract_duration_end: contract.contract_duration_end,
    }).eq("id", contract.id);
    if (error) toast.error(error.message); else toast.success("Sections saved");
  };

  const addFromMatrix = async (m: MatrixItem) => {
    if (!contract) return;
    try {
      await _upsert({ data: {
        contract_id: contract.id, category: m.category as never,
        objective: m.target, target: m.target, unit: m.unit, type: m.type,
        source: m.source ?? null, weight: Number(m.weight), matrix_id: m.id,
        sort_order: objectives.filter((o) => o.category === m.category).length,
      }});
      load(userId);
    } catch (e: unknown) { toast.error((e as Error).message); }
  };

  const addBlank = async (category: string) => {
    if (!contract) return;
    try {
      await _upsert({ data: {
        contract_id: contract.id, category: category as never,
        objective: "New cross category", target: "0",
        unit: "Number", type: "Quantitative", source: sources[0]?.label ?? null,
        weight: 0,
        sort_order: objectives.filter((o) => o.category === category).length,
      }});
      load(userId);
    } catch (e: unknown) { toast.error((e as Error).message); }
  };

  const saveObjective = async (o: Objective) => {
    // Auto-calculate achievement_pct if target and achievement are numeric
    let achievement_pct = o.achievement_pct;
    const tNum = parseFloat(o.target ?? "");
    const aNum = parseFloat(o.achievement ?? "");
    if (!isNaN(tNum) && !isNaN(aNum) && tNum > 0) {
      achievement_pct = Math.round((aNum / tNum) * 100 * 100) / 100;
    }
    try {
      await _upsert({ data: {
        id: o.id, contract_id: o.contract_id, category: o.category as never,
        objective: o.objective, target: o.target, unit: o.unit, type: o.type,
        source: o.source, weight: Number(o.weight), sort_order: o.sort_order,
        matrix_id: o.matrix_id,
        achievement: o.achievement ?? undefined,
        achievement_pct: achievement_pct ?? undefined,
      }});
      // Save current_status directly (not in server function)
      await supabase.from("contract_objectives").update({ current_status: o.current_status }).eq("id", o.id);
      toast.success("Saved");
    } catch (e: unknown) { toast.error((e as Error).message); }
  };

  const removeObjective = async (id: string) => {
    try { await _delete({ data: { id } }); load(userId); }
    catch (e: unknown) { toast.error((e as Error).message); }
  };

  const submit = async () => {
    if (!contract) return;
    // Weight validation: check each category meets its recommended weight
    const catErrors: string[] = [];
    for (const cat of categories) {
      const catObjs = objectives.filter((o) => o.category === cat.category_key);
      const catTotal = catObjs.reduce((s, o) => s + Number(o.weight ?? 0), 0);
      if (catTotal !== cat.recommended_weight) {
        catErrors.push(`${cat.label}: allocated ${catTotal.toFixed(1)}, required ${cat.recommended_weight}`);
      }
    }
    if (catErrors.length > 0) {
      toast.error(`Weight validation failed:\n${catErrors.join("\n")}`);
      return;
    }
    if (Math.round(totalWeight) !== 100) {
      toast.error(`Total weight must equal 100 (currently ${totalWeight.toFixed(1)})`);
      return;
    }
    try { await _transition({ data: { id: contract.id, to: "submitted" } });
      toast.success("Submitted for negotiation"); load(userId);
    } catch (e: unknown) { toast.error((e as Error).message); }
  };

  const reopen = async () => {
    if (!contract) return;
    const reason = window.prompt("Reason for reopening this contract?");
    if (!reason) return;
    try { await _reopen({ data: { id: contract.id, reason } }); toast.success("Reopened"); load(userId); }
    catch (e: unknown) { toast.error((e as Error).message); }
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        <AppHeader userId={userId} />
        <main className="max-w-6xl mx-auto p-6 space-y-6">
          <div>
            <h1 className="text-3xl font-display font-bold">My Performance Contract</h1>
            <p className="text-muted-foreground">Official County Performance Contracting workflow · <span className="font-medium text-foreground">{meta.label}</span></p>
          </div>

          {loading ? <p>Loading…</p> : (
            <>
              {/* Entity + hierarchy */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <meta.icon className="h-5 w-5 text-primary" />
                    <CardTitle className="text-base">Approval Hierarchy — {meta.label}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {meta.hierarchy.map((h, i) => (
                      <span key={h} className="inline-flex items-center gap-2">
                        <Badge variant={i === 0 ? "default" : "outline"}>{h}</Badge>
                        {i < meta.hierarchy.length - 1 && <span className="text-muted-foreground">↓</span>}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">Final signatory: <span className="font-medium text-foreground">{meta.final}</span></p>
                </CardContent>
              </Card>

              {contract && (
                <Card>
                  <CardContent className="pt-6 flex flex-wrap gap-2 items-center">
                    {STATUS_STEPS.map((s) => {
                      const idx = STATUS_STEPS.indexOf(contract.status);
                      const active = STATUS_STEPS.indexOf(s) <= idx;
                      return <Badge key={s} variant={active ? "default" : "outline"} className="capitalize">{s.replace(/_/g, " ")}</Badge>;
                    })}
                    {contract.contract_number && <Badge variant="secondary">{contract.contract_number}</Badge>}
                  </CardContent>
                </Card>
              )}

              {!contract && (
                <Card>
                  <CardHeader><CardTitle>Start Performance Contract</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    {!canStart ? (
                      <p className="text-destructive text-sm">
                        Only Governor, CEC, Chief Officers, Directors and Supervisors prepare Performance Contracts. Your parent contract in the hierarchy must be signed first.
                      </p>
                    ) : (
                      <>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div>
                            <Label>Performance Contract Entity</Label>
                            <Select value={entityChoice} onValueChange={(v) => setEntityChoice(v as EntityType)}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {(Object.entries(ENTITY_META) as [EntityType, typeof ENTITY_META[EntityType]][]).map(([k, v]) => (
                                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <p className="text-[11px] text-muted-foreground mt-1">
                              {ENTITY_META[entityChoice].hierarchy.join(" → ")}. Final: {ENTITY_META[entityChoice].final}.
                            </p>
                          </div>
                        </div>
                        <Button onClick={handleCreate}>Create Performance Contract</Button>
                      </>
                    )}
                  </CardContent>
                </Card>
              )}

              {contract && (
                <>
                  {/* Contract sections */}
                  <Card>
                    <CardHeader><CardTitle>Contract Sections</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                      {([
                        ["Statement of Responsibility", "statement_of_responsibility"],
                        ["Vision", "vision_statement"],
                        ["Mission", "mission_statement"],
                        ["Strategic Objectives", "strategic_objectives"],
                        ["Statement of Strategic Intent", "statement_of_strategic_intent"],
                        ["Commitments and Obligations", "commitments_and_obligations"],
                        ["Reporting Requirements", "reporting_requirements"],
                      ] as const).map(([label, key]) => (
                        <div key={key}>
                          <Label>{label}</Label>
                          <Textarea value={(contract[key] as string) ?? ""} disabled={!!locked}
                            onChange={(e) => setContract({ ...contract, [key]: e.target.value })} rows={2} />
                        </div>
                      ))}
                      <div className="grid grid-cols-2 gap-3">
                        <div><Label>Contract Start</Label>
                          <Input type="date" value={contract.contract_duration_start ?? ""} disabled={!!locked}
                            onChange={(e) => setContract({ ...contract, contract_duration_start: e.target.value })} /></div>
                        <div><Label>Contract End</Label>
                          <Input type="date" value={contract.contract_duration_end ?? ""} disabled={!!locked}
                            onChange={(e) => setContract({ ...contract, contract_duration_end: e.target.value })} /></div>
                      </div>
                      <Button onClick={saveSections} disabled={!!locked}>Save sections</Button>
                    </CardContent>
                  </Card>

                  {/* Performance Matrix header */}
                  <Card>
                    <CardHeader className="pb-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <CardTitle className="text-base">Performance Matrix</CardTitle>
                        <Badge variant={Math.round(totalWeight) === 100 ? "default" : "secondary"}>
                          Total weight: {totalWeight.toFixed(1)} / 100
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Each category shows its recommended weight. The allocated weight must exactly match before submission.
                      </p>
                    </CardHeader>
                  </Card>

                  {/* Category sections */}
                  {categories.map((cat) => {
                    const rows = objectives.filter((o) => o.category === cat.category_key);
                    const catTotal = rows.reduce((s, o) => s + Number(o.weight ?? 0), 0);
                    const remaining = cat.recommended_weight - catTotal;
                    const weightOk = catTotal === cat.recommended_weight;
                    const deptRows = matrixItems.filter((mi) => mi.category === cat.category_key);
                    return (
                      <Card key={cat.category_key}>
                        <CardContent className="pt-5 grid gap-4 md:grid-cols-[240px_1fr]">
                          {/* Left column: category info */}
                          <div className="md:border-r md:pr-4">
                            <div className="text-xs font-semibold uppercase tracking-widest text-primary">Category</div>
                            <h3 className="font-display text-lg font-bold mt-1">{cat.label}</h3>
                            {cat.description && <p className="text-xs text-muted-foreground mt-1">{cat.description}</p>}

                            {/* Weight indicator */}
                            <div className="mt-3 rounded-lg border bg-muted/30 p-3 text-xs space-y-1">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Recommended</span>
                                <span className="font-semibold">{cat.recommended_weight}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Allocated</span>
                                <span className={`font-semibold ${catTotal > cat.recommended_weight ? "text-destructive" : ""}`}>{catTotal.toFixed(1)}</span>
                              </div>
                              <div className="flex justify-between border-t pt-1">
                                <span className="text-muted-foreground">Remaining</span>
                                <span className={`font-semibold ${remaining < 0 ? "text-destructive" : remaining === 0 ? "text-primary" : ""}`}>
                                  {remaining >= 0 ? remaining.toFixed(1) : `−${Math.abs(remaining).toFixed(1)}`}
                                </span>
                              </div>
                            </div>
                            <Badge className="mt-2" variant={weightOk ? "default" : remaining < 0 ? "destructive" : "secondary"}>
                              {weightOk ? "✓ Weight met" : remaining < 0 ? "Exceeded" : `${remaining.toFixed(1)} remaining`}
                            </Badge>

                            {!locked && (
                              <div className="mt-3 space-y-2">
                                <Select onValueChange={(id) => { const mi = deptRows.find((x) => x.id === id); if (mi) addFromMatrix(mi); }}>
                                  <SelectTrigger className="w-full"><SelectValue placeholder="+ Add from Matrix" /></SelectTrigger>
                                  <SelectContent>
                                    {deptRows.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No matrix targets in this category</div>}
                                    {deptRows.map((mi) => (
                                      <SelectItem key={mi.id} value={mi.id}>{mi.target} · {mi.weight}%</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Button size="sm" variant="outline" className="w-full" onClick={() => addBlank(cat.category_key)}>+ Blank row</Button>
                              </div>
                            )}
                          </div>

                          {/* Right column: matrix table */}
                          <div className="overflow-x-auto">
                            {rows.length === 0 ? (
                              <p className="text-xs text-muted-foreground italic py-6 text-center">No targets in this category yet.</p>
                            ) : (
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>
                                      <div className="flex items-center gap-1">
                                        Cross Category
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Info className="h-3.5 w-3.5 text-muted-foreground cursor-pointer" />
                                          </TooltipTrigger>
                                          <TooltipContent className="max-w-xs text-xs" side="top">
                                            The specific performance target or objective within the <strong>{cat.label}</strong> category.
                                            {cat.guidance && <p className="mt-1 text-muted-foreground">{cat.guidance}</p>}
                                          </TooltipContent>
                                        </Tooltip>
                                      </div>
                                    </TableHead>
                                    <TableHead className="w-36">Current Status</TableHead>
                                    <TableHead className="w-24">Unit</TableHead>
                                    <TableHead className="w-16">Weight</TableHead>
                                    <TableHead className="w-28">Type</TableHead>
                                    <TableHead className="w-36">Source</TableHead>
                                    {!locked && <TableHead className="w-24 text-right">Actions</TableHead>}
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {rows.map((o) => {
                                    // Auto-compute achievement pct display
                                    const tNum = parseFloat(o.target ?? "");
                                    const aNum = parseFloat(o.achievement ?? "");
                                    const pct = !isNaN(tNum) && !isNaN(aNum) && tNum > 0
                                      ? Math.round((aNum / tNum) * 100 * 10) / 10
                                      : o.achievement_pct;
                                    return (
                                      <TableRow key={o.id}>
                                        <TableCell>
                                          <div className="space-y-1">
                                            <Input value={o.objective} disabled={!!locked} placeholder="Cross category target"
                                              onChange={(e) => setObjectives(objectives.map(x => x.id === o.id ? { ...x, objective: e.target.value, target: e.target.value } : x))} />
                                            <div className="flex gap-1">
                                              <Input type="number" value={o.target ?? ""} disabled={!!locked} placeholder="Target (numeric)"
                                                className="w-24 text-xs" title="Performance indicator target (numeric)"
                                                onChange={(e) => setObjectives(objectives.map(x => x.id === o.id ? { ...x, target: e.target.value } : x))} />
                                              <Input type="number" value={o.achievement ?? ""} disabled={!!locked} placeholder="Achieved"
                                                className="w-24 text-xs" title="Achieved result (numeric)"
                                                onChange={(e) => setObjectives(objectives.map(x => x.id === o.id ? { ...x, achievement: e.target.value } : x))} />
                                              {pct !== null && pct !== undefined && (
                                                <span className={`self-center rounded px-1.5 py-0.5 text-[11px] font-semibold border ${pct >= 100 ? "bg-emerald-100 text-emerald-700 border-emerald-300" : pct >= 80 ? "bg-blue-100 text-blue-700 border-blue-300" : "bg-amber-100 text-amber-700 border-amber-300"}`}>
                                                  {pct.toFixed(1)}%
                                                </span>
                                              )}
                                            </div>
                                          </div>
                                        </TableCell>
                                        <TableCell>
                                          <Select value={o.current_status ?? ""} disabled={!!locked}
                                            onValueChange={(v) => setObjectives(objectives.map(x => x.id === o.id ? { ...x, current_status: v || null } : x))}>
                                            <SelectTrigger className="text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="">— None —</SelectItem>
                                              {statusOptions.map((s) => <SelectItem key={s.id} value={s.label}>{s.label}</SelectItem>)}
                                            </SelectContent>
                                          </Select>
                                        </TableCell>
                                        <TableCell>
                                          <Input value={o.unit ?? ""} disabled={!!locked} className="text-xs"
                                            onChange={(e) => setObjectives(objectives.map(x => x.id === o.id ? { ...x, unit: e.target.value } : x))} />
                                        </TableCell>
                                        <TableCell>
                                          <Input type="number" value={o.weight} disabled={!!locked} className="text-xs"
                                            onChange={(e) => setObjectives(objectives.map(x => x.id === o.id ? { ...x, weight: Number(e.target.value) } : x))} />
                                        </TableCell>
                                        <TableCell>
                                          <Input value={o.type ?? ""} disabled={!!locked} className="text-xs"
                                            onChange={(e) => setObjectives(objectives.map(x => x.id === o.id ? { ...x, type: e.target.value } : x))} />
                                        </TableCell>
                                        <TableCell>
                                          <Select value={o.source ?? ""} disabled={!!locked}
                                            onValueChange={(v) => setObjectives(objectives.map(x => x.id === o.id ? { ...x, source: v } : x))}>
                                            <SelectTrigger className="text-xs"><SelectValue placeholder="Source" /></SelectTrigger>
                                            <SelectContent>
                                              {sources.map((s) => (<SelectItem key={s.id} value={s.label}>{s.label}</SelectItem>))}
                                            </SelectContent>
                                          </Select>
                                        </TableCell>
                                        {!locked && (
                                          <TableCell className="text-right space-x-1">
                                            <Button size="sm" onClick={() => saveObjective(o)}>Save</Button>
                                            <Button size="sm" variant="destructive" onClick={() => removeObjective(o.id)}>Del</Button>
                                          </TableCell>
                                        )}
                                      </TableRow>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}

                  {/* Digital Signatures */}
                  {(() => {
                    const seniorSig = signoffs.find((s) => !s.is_owner);
                    const ownerSig = signoffs.find((s) => s.is_owner);
                    const isOwner = contract.owner_id === userId;
                    const fullySigned = !!seniorSig && !!ownerSig;
                    return (
                      <Card>
                        <CardHeader className="pb-3 border-b">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <CardTitle className="text-base flex items-center gap-2">
                              <FileSignature className="h-4 w-4 text-primary" /> Digital Signatures
                            </CardTitle>
                            <Badge variant={fullySigned ? "default" : "secondary"} className="text-[10px]">
                              {fullySigned ? "Fully Signed & Locked" : seniorSig ? "Awaiting Contract Owner" : "Awaiting Senior Officer"}
                            </Badge>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-1">
                            Both signatures are required. The Senior Officer signs first; the Performance Contract Owner then applies the final acknowledgment.
                          </p>
                        </CardHeader>
                        <CardContent className="pt-4 grid gap-4 md:grid-cols-2">
                          {/* Senior Officer */}
                          <SignatureBlock
                            label="Senior Officer Signature"
                            subtitle="Supervising officer who reviews the Performance Contract."
                            sig={seniorSig}
                          />

                          {/* Contract Owner */}
                          <div className="rounded-lg border p-4">
                            <div className="text-[10px] font-semibold uppercase tracking-widest text-primary">Performance Contract Owner Signature</div>
                            <div className="mt-2 text-xs text-muted-foreground">Officer whose Performance Contract is being executed.</div>
                            {ownerSig ? (
                              <SignedBlock sig={ownerSig} locked />
                            ) : !isOwner ? (
                              <div className="mt-3 rounded border border-dashed p-3 text-xs text-muted-foreground">
                                Only the Performance Contract Owner may apply this signature.
                              </div>
                            ) : !seniorSig ? (
                              <div className="mt-3 rounded border border-dashed p-3 text-xs text-muted-foreground">
                                Awaiting supervisory approval and Senior Officer signature.
                              </div>
                            ) : (
                              <div className="mt-3 space-y-3">
                                {/* Signing mode toggle */}
                                <div className="flex gap-2">
                                  <Button size="sm" variant={ownerSignMode === "typed" ? "default" : "outline"}
                                    onClick={() => setOwnerSignMode("typed")}>
                                    <FileSignature className="h-3 w-3 mr-1" /> Typed signature
                                  </Button>
                                  <Button size="sm" variant={ownerSignMode === "image" ? "default" : "outline"}
                                    onClick={() => setOwnerSignMode("image")}>
                                    <Image className="h-3 w-3 mr-1" /> Upload signature
                                  </Button>
                                </div>

                                <div>
                                  <Label className="text-[11px]">Full name *</Label>
                                  <Input value={ownerSignName} onChange={(e) => setOwnerSignName(e.target.value)} placeholder="Type your full name" />
                                </div>
                                <div>
                                  <Label className="text-[11px]">Designation</Label>
                                  <Input value={ownerSignPosition} onChange={(e) => setOwnerSignPosition(e.target.value)} placeholder="e.g. Director of Health" />
                                </div>

                                {ownerSignMode === "typed" ? (
                                  <div className="rounded border bg-muted/30 px-3 py-2 font-display text-lg italic text-primary min-h-[40px]">
                                    {ownerSignName ? `/s/ ${ownerSignName}` : <span className="text-muted-foreground text-sm">Your typed signature will appear here</span>}
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    <Label className="text-[11px]">Signature image (PNG, JPG, JPEG · max 10 MB)</Label>
                                    <Input type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                                      onChange={handleSignFileChange} />
                                    {ownerSignPreview && (
                                      <div className="relative inline-block">
                                        <img src={ownerSignPreview} alt="Signature preview" className="max-h-16 border rounded" />
                                        <button onClick={() => { setOwnerSignFile(null); setOwnerSignPreview(null); }} className="absolute -top-1 -right-1 rounded-full bg-destructive text-destructive-foreground h-4 w-4 flex items-center justify-center">
                                          <X className="h-2.5 w-2.5" />
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}

                                <Button onClick={handleOwnerSign} disabled={signing || !ownerSignName.trim()} className="w-full">
                                  <FileSignature className="mr-1.5 h-4 w-4" />
                                  {signing ? "Signing…" : "Sign & Lock Contract"}
                                </Button>
                                <p className="text-[10px] text-muted-foreground">
                                  By signing, you confirm you have read and accept the terms. Your signature, name, designation and timestamp will be recorded.
                                </p>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })()}

                  {/* Workflow Actions */}
                  <Card>
                    <CardHeader><CardTitle>Workflow Actions</CardTitle></CardHeader>
                    <CardContent className="flex flex-wrap gap-2">
                      {["draft", "returned_for_amendment", "reopened"].includes(contract.status) && (
                        <Button onClick={submit}>Submit for Negotiation & Review</Button>
                      )}
                      {contract.status === "locked" && (
                        <Button variant="outline" onClick={reopen}>Request Reopen</Button>
                      )}
                      <div className="text-xs text-muted-foreground pt-2 w-full">
                        Each category's weight must equal its recommended weight before submission. Final signatory: <span className="font-medium text-foreground">{meta.final}</span>.
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}
            </>
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}

// ── Signature display components ──────────────────────────────

function SignatureBlock({ label, subtitle, sig }: {
  label: string; subtitle: string;
  sig?: { signer_name: string; signer_position: string | null; signed_at: string; signature_image_path?: string | null } | undefined;
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-primary">{label}</div>
      <div className="mt-2 text-xs text-muted-foreground">{subtitle}</div>
      {sig ? (
        <SignedBlock sig={sig} />
      ) : (
        <div className="mt-3 rounded border border-dashed p-3 text-xs text-muted-foreground">
          Awaiting signature from this role.
        </div>
      )}
    </div>
  );
}

function SignedBlock({ sig, locked: isLocked }: {
  sig: { signer_name: string; signer_position: string | null; signed_at: string; signature_image_path?: string | null };
  locked?: boolean;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const loaded = useRef(false);
  useEffect(() => {
    if (sig.signature_image_path && !loaded.current) {
      loaded.current = true;
      supabase.storage.from("signatures").createSignedUrl(sig.signature_image_path, 3600).then(({ data }) => {
        if (data?.signedUrl) setImageUrl(data.signedUrl);
      });
    }
  }, [sig.signature_image_path]);

  return (
    <div className="mt-3 space-y-1 text-xs">
      <div><span className="text-muted-foreground">Name:</span> <span className="font-medium">{sig.signer_name}</span></div>
      <div><span className="text-muted-foreground">Designation:</span> {sig.signer_position ?? "—"}</div>
      {imageUrl ? (
        <img src={imageUrl} alt="Signature" className="max-h-14 border rounded mt-1" />
      ) : (
        <div className="mt-2 rounded border bg-muted/30 px-3 py-2 font-display text-lg italic text-primary">/s/ {sig.signer_name}</div>
      )}
      <div className="flex items-center gap-1 text-[11px] text-primary">
        {isLocked ? <Lock className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
        Signed on {new Date(sig.signed_at).toLocaleString()}{isLocked ? " — contract locked" : ""}
      </div>
    </div>
  );
}
