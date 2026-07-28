import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AppHeader } from "@/components/AppHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useRoles, hasAnyRole } from "@/hooks/useRoles";
import { loadPerformanceMatrixState } from "@/lib/performance-matrix";
import { getAdminMatrixDepartments } from "@/lib/admin-matrix-data.functions";
import { ArrowUp, ArrowDown, Trash2, Plus, ClipboardCheck, Info, Pencil, GripVertical } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/matrix")({
  head: () => ({ meta: [{ title: "Performance Matrix Management — Bungoma CPMS" }] }),
  component: MatrixAdmin,
});

const UNITS = ["%", "Number", "Ksh", "Report", "Days", "Months", "Compliance"];
const TYPES = ["Quantitative", "Qualitative", "Continuous", "Compliance", "Strategic", "Financial"];

type MatrixRow = {
  id: string; department: string; category: string; target: string;
  unit: string; weight: number; type: string; source: string | null;
  sort_order: number; is_active: boolean; current_status: string | null;
};
type SourceRow = { id: string; department: string; label: string; is_active: boolean; sort_order: number };
type CategoryRow = {
  id: string; department: string; category_key: string; label: string;
  recommended_weight: number; description: string | null; guidance: string | null;
  sort_order: number; is_active: boolean;
};
type StatusOption = { id: string; department: string; label: string; sort_order: number; is_active: boolean };

function MatrixAdmin() {
  const { user } = Route.useRouteContext();
  const { data: roles } = useRoles(user.id);
  const isSysAdmin = hasAnyRole(roles, ["system_admin", "super_admin"]);
  const isDeptAdmin = hasAnyRole(roles, ["dept_admin"]);
  const allowed = isSysAdmin || isDeptAdmin;
  const getDepartmentsFn = useServerFn(getAdminMatrixDepartments);

  const [departments, setDepartments] = useState<string[]>([]);
  const [department, setDepartment] = useState<string>("");
  const [rows, setRows] = useState<MatrixRow[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [statusOptions, setStatusOptions] = useState<StatusOption[]>([]);
  const [newSource, setNewSource] = useState("");
  const [newStatus, setNewStatus] = useState("");
  const [loading, setLoading] = useState(true);

  // Category dialog state
  const [catDialog, setCatDialog] = useState<{ open: boolean; editing: CategoryRow | null }>({ open: false, editing: null });
  const [catForm, setCatForm] = useState({ category_key: "", label: "", recommended_weight: 20, description: "", guidance: "" });

  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        const departmentsResult = await getDepartmentsFn({ data: undefined as never });
        const uniq = Array.from(new Set((departmentsResult ?? []).filter(Boolean) as string[])).sort();

        if (!isMounted) return;

        setDepartments(uniq);
        setDepartment((prev) => (prev && uniq.includes(prev) ? prev : uniq[0] ?? ""));
      } catch (error) {
        if (!isMounted) return;
        toast.error(error instanceof Error ? error.message : "Unable to load departments");
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [user.id, isSysAdmin]);

  const load = async (dept: string) => {
    setLoading(true);
    try {
      const { matrixRows, sourceRows, categories: categoryRows, statusRows } = await loadPerformanceMatrixState(supabase, dept);
      setRows((matrixRows ?? []) as unknown as MatrixRow[]);
      setSources((sourceRows ?? []) as unknown as SourceRow[]);
      setCategories((categoryRows ?? []) as unknown as CategoryRow[]);
      setStatusOptions((statusRows ?? []) as unknown as StatusOption[]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load the Performance Matrix");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (department) load(department); }, [department]);

  const total = rows.filter((r) => r.is_active).reduce((s, r) => s + Number(r.weight ?? 0), 0);
  const activeSources = sources.filter((s) => s.is_active);
  const activeStatusOptions = statusOptions.filter((s) => s.is_active);
  const activeCategories = categories.filter((c) => c.is_active).sort((a, b) => a.sort_order - b.sort_order);

  // ── Matrix row CRUD ──────────────────────────────────────────
  const addRow = async (categoryKey: string) => {
    const nextOrder = Math.max(0, ...rows.filter((r) => r.category === categoryKey).map((r) => r.sort_order)) + 1;
    const { error } = await supabase.from("performance_matrix").insert({
      department, category: categoryKey, target: "New cross category", unit: "Number", weight: 0, type: "Quantitative",
      source: activeSources[0]?.label ?? null, sort_order: nextOrder, is_active: true,
    });
    if (error) return toast.error(error.message);
    load(department);
  };

  const save = async (r: MatrixRow) => {
    const { error } = await supabase.from("performance_matrix").update({
      target: r.target, unit: r.unit, weight: Number(r.weight), type: r.type,
      source: r.source, is_active: r.is_active, current_status: r.current_status,
    }).eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success("Saved");
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this performance target?")) return;
    const { error } = await supabase.from("performance_matrix").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load(department);
  };

  const move = async (r: MatrixRow, dir: -1 | 1) => {
    const peers = rows.filter((x) => x.category === r.category).sort((a, b) => a.sort_order - b.sort_order);
    const idx = peers.findIndex((x) => x.id === r.id);
    const swap = peers[idx + dir];
    if (!swap) return;
    await supabase.from("performance_matrix").update({ sort_order: swap.sort_order }).eq("id", r.id);
    await supabase.from("performance_matrix").update({ sort_order: r.sort_order }).eq("id", swap.id);
    load(department);
  };

  const toggleActive = async (r: MatrixRow, is_active: boolean) => {
    setRows((prev) => prev.map((x) => x.id === r.id ? { ...x, is_active } : x));
    const { error } = await supabase.from("performance_matrix").update({ is_active }).eq("id", r.id);
    if (error) toast.error(error.message);
  };

  // ── Sources CRUD ──────────────────────────────────────────────
  const addSource = async () => {
    if (!newSource.trim()) return;
    const nextOrder = Math.max(0, ...sources.map((s) => s.sort_order)) + 1;
    const { error } = await supabase.from("matrix_sources").insert({ department, label: newSource.trim(), sort_order: nextOrder, is_active: true });
    if (error) return toast.error(error.message);
    setNewSource(""); load(department);
  };
  const updateSource = async (s: SourceRow, patch: Partial<SourceRow>) => {
    setSources((prev) => prev.map((x) => x.id === s.id ? { ...x, ...patch } : x));
    await supabase.from("matrix_sources").update(patch).eq("id", s.id);
  };
  const removeSource = async (id: string) => {
    if (!confirm("Delete this source value?")) return;
    const { error } = await supabase.from("matrix_sources").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load(department);
  };

  // ── Status options CRUD ───────────────────────────────────────
  const addStatusOption = async () => {
    if (!newStatus.trim()) return;
    const nextOrder = Math.max(0, ...statusOptions.map((s) => s.sort_order)) + 1;
    const { error } = await supabase.from("matrix_status_options").insert({ department, label: newStatus.trim(), sort_order: nextOrder, is_active: true });
    if (error) return toast.error(error.message);
    setNewStatus(""); load(department);
  };
  const toggleStatus = async (s: StatusOption, is_active: boolean) => {
    setStatusOptions((prev) => prev.map((x) => x.id === s.id ? { ...x, is_active } : x));
    await supabase.from("matrix_status_options").update({ is_active }).eq("id", s.id);
  };
  const removeStatusOption = async (id: string) => {
    if (!confirm("Delete this status option?")) return;
    const { error } = await supabase.from("matrix_status_options").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load(department);
  };

  // ── Category CRUD ─────────────────────────────────────────────
  const openCatDialog = (cat?: CategoryRow) => {
    if (cat) {
      setCatForm({ category_key: cat.category_key, label: cat.label, recommended_weight: cat.recommended_weight, description: cat.description ?? "", guidance: cat.guidance ?? "" });
      setCatDialog({ open: true, editing: cat });
    } else {
      setCatForm({ category_key: "", label: "", recommended_weight: 0, description: "", guidance: "" });
      setCatDialog({ open: true, editing: null });
    }
  };
  const saveCat = async () => {
    if (!catForm.label.trim() || !catForm.category_key.trim()) { toast.error("Key and label are required"); return; }
    if (catDialog.editing) {
      const { error } = await supabase.from("performance_categories").update({
        label: catForm.label, recommended_weight: Number(catForm.recommended_weight),
        description: catForm.description || null, guidance: catForm.guidance || null,
        updated_at: new Date().toISOString(),
      }).eq("id", catDialog.editing.id);
      if (error) return toast.error(error.message);
      toast.success("Category updated");
    } else {
      const nextOrder = Math.max(0, ...categories.map((c) => c.sort_order)) + 1;
      const { error } = await supabase.from("performance_categories").insert({
        department, category_key: catForm.category_key.trim().toLowerCase().replace(/\s+/g, "_"),
        label: catForm.label, recommended_weight: Number(catForm.recommended_weight),
        description: catForm.description || null, guidance: catForm.guidance || null,
        sort_order: nextOrder, is_active: true,
      });
      if (error) return toast.error(error.message);
      toast.success("Category added");
    }
    setCatDialog({ open: false, editing: null });
    load(department);
  };
  const deleteCat = async (cat: CategoryRow) => {
    const inUse = rows.some((r) => r.category === cat.category_key);
    if (inUse) { toast.error("Cannot delete — this category has existing targets. Deactivate it instead."); return; }
    if (!confirm(`Delete category "${cat.label}"?`)) return;
    const { error } = await supabase.from("performance_categories").delete().eq("id", cat.id);
    if (error) return toast.error(error.message);
    load(department);
  };
  const toggleCat = async (cat: CategoryRow, is_active: boolean) => {
    setCategories((prev) => prev.map((x) => x.id === cat.id ? { ...x, is_active } : x));
    await supabase.from("performance_categories").update({ is_active, updated_at: new Date().toISOString() }).eq("id", cat.id);
  };
  const moveCat = async (cat: CategoryRow, dir: -1 | 1) => {
    const sorted = [...categories].sort((a, b) => a.sort_order - b.sort_order);
    const idx = sorted.findIndex((c) => c.id === cat.id);
    const swap = sorted[idx + dir];
    if (!swap) return;
    await supabase.from("performance_categories").update({ sort_order: swap.sort_order }).eq("id", cat.id);
    await supabase.from("performance_categories").update({ sort_order: cat.sort_order }).eq("id", swap.id);
    load(department);
  };

  if (!allowed) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader authenticated userId={user.id} />
        <main className="max-w-3xl mx-auto p-10">
          <Card className="p-10 text-center">
            <ClipboardCheck className="mx-auto h-10 w-10 text-muted-foreground" />
            <h1 className="mt-3 font-display text-2xl font-bold">Departmental Administrator access required</h1>
            <p className="mt-2 text-sm text-muted-foreground">Only Departmental Administrators may manage the Performance Matrix.</p>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        <AppHeader authenticated userId={user.id} />
        <main className="max-w-6xl mx-auto p-6 space-y-6">
          {/* Page header */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-primary">Departmental Administrator</div>
            <h1 className="font-display text-3xl font-bold">Performance Matrix Management</h1>
            <p className="text-sm text-muted-foreground">
              Manage performance categories, cross-category targets, source and status values. Officers select from these targets when preparing contracts.
            </p>
          </div>

          {/* Department selector */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-base">Department</CardTitle>
                <div className="flex items-center gap-3">
                  <Select value={department} onValueChange={setDepartment}>
                    <SelectTrigger className="w-[260px]"><SelectValue placeholder="Select department" /></SelectTrigger>
                    <SelectContent>
                      {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Badge variant={Math.round(total) === 100 ? "default" : "secondary"}>
                    Active total weight: {total.toFixed(1)} / 100
                  </Badge>
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* ── Category Management ────────────────────────────── */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">Performance Categories</CardTitle>
                <Button size="sm" onClick={() => openCatDialog()}><Plus className="h-3.5 w-3.5 mr-1" /> Add category</Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Define the performance categories for this department. Each category has a recommended weight that officers must meet.
              </p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="w-36">Key</TableHead>
                    <TableHead className="w-32">Rec. Weight</TableHead>
                    <TableHead className="w-20 text-center">Active</TableHead>
                    <TableHead className="w-40 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categories.sort((a, b) => a.sort_order - b.sort_order).map((cat, i, arr) => (
                    <TableRow key={cat.id} className={cat.is_active ? "" : "opacity-50"}>
                      <TableCell className="text-xs text-muted-foreground"><GripVertical className="h-3 w-3 inline mr-1 opacity-40" />{i + 1}</TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{cat.label}</div>
                        {cat.description && <div className="text-xs text-muted-foreground">{cat.description}</div>}
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">{cat.category_key}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{cat.recommended_weight}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch checked={cat.is_active} onCheckedChange={(v) => toggleCat(cat, v)} />
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button size="sm" variant="ghost" onClick={() => moveCat(cat, -1)} disabled={i === 0}><ArrowUp className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => moveCat(cat, 1)} disabled={i === arr.length - 1}><ArrowDown className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => openCatDialog(cat)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="destructive" onClick={() => deleteCat(cat)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {categories.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-6">No categories yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* ── Matrix tables per category ─────────────────────── */}
          {loading ? <p className="text-sm text-muted-foreground">Loading matrix…</p> : (
            activeCategories.map((cat) => {
              const catRows = rows.filter((r) => r.category === cat.category_key).sort((a, b) => a.sort_order - b.sort_order);
              const catTotal = catRows.filter((r) => r.is_active).reduce((s, r) => s + Number(r.weight ?? 0), 0);
              const remaining = cat.recommended_weight - catTotal;
              return (
                <Card key={cat.id}>
                  <CardHeader className="pb-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <CardTitle className="text-base">{cat.label}</CardTitle>
                        {cat.guidance && <p className="text-xs text-muted-foreground mt-0.5">{cat.guidance}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        {/* Weight indicator */}
                        <div className="text-xs space-x-2">
                          <span className="text-muted-foreground">Recommended: <span className="font-semibold text-foreground">{cat.recommended_weight}</span></span>
                          <span className="text-muted-foreground">Allocated: <span className={`font-semibold ${catTotal > cat.recommended_weight ? "text-destructive" : "text-foreground"}`}>{catTotal.toFixed(1)}</span></span>
                          <span className={`font-semibold ${remaining < 0 ? "text-destructive" : remaining === 0 ? "text-primary" : "text-muted-foreground"}`}>
                            {remaining >= 0 ? `Remaining: ${remaining.toFixed(1)}` : `Exceeded by ${Math.abs(remaining).toFixed(1)}`}
                          </span>
                        </div>
                        <Badge variant={catTotal === cat.recommended_weight ? "default" : catTotal > cat.recommended_weight ? "destructive" : "secondary"}>
                          {catTotal.toFixed(1)} / {cat.recommended_weight}
                        </Badge>
                        <Button size="sm" onClick={() => addRow(cat.category_key)}><Plus className="h-3.5 w-3.5 mr-1" /> Add target</Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">#</TableHead>
                          <TableHead>
                            <div className="flex items-center gap-1">
                              Cross Category
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-pointer" />
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs text-xs" side="right">
                                  <p className="font-semibold mb-1">Cross Category</p>
                                  <p>The specific performance target or objective within the <strong>{cat.label}</strong> category.</p>
                                  {cat.guidance && <p className="mt-1 text-muted-foreground">{cat.guidance}</p>}
                                  <p className="mt-1">Assign units, weights, types and sources carefully to ensure the contract accurately reflects the performance commitment.</p>
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          </TableHead>
                          <TableHead className="w-44">Current Status</TableHead>
                          <TableHead className="w-28">Unit</TableHead>
                          <TableHead className="w-20">Weight</TableHead>
                          <TableHead className="w-32">Type</TableHead>
                          <TableHead className="w-40">Source</TableHead>
                          <TableHead className="w-20 text-center">Active</TableHead>
                          <TableHead className="w-40 text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {catRows.map((r, i) => (
                          <TableRow key={r.id} className={r.is_active ? "" : "opacity-60"}>
                            <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                            <TableCell>
                              <Input
                                value={r.target}
                                onChange={(e) => setRows((prev) => prev.map((x) => x.id === r.id ? { ...x, target: e.target.value } : x))}
                                placeholder="Enter cross category target"
                              />
                            </TableCell>
                            <TableCell>
                              <Select
                                value={r.current_status ?? ""}
                                onValueChange={(v) => setRows((prev) => prev.map((x) => x.id === r.id ? { ...x, current_status: v || null } : x))}
                              >
                                <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="">— None —</SelectItem>
                                  {activeStatusOptions.map((s) => <SelectItem key={s.id} value={s.label}>{s.label}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Select value={r.unit} onValueChange={(v) => setRows((prev) => prev.map((x) => x.id === r.id ? { ...x, unit: v } : x))}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>{UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Input type="number" min={0} max={100} value={r.weight}
                                onChange={(e) => setRows((prev) => prev.map((x) => x.id === r.id ? { ...x, weight: Number(e.target.value) } : x))} />
                            </TableCell>
                            <TableCell>
                              <Select value={r.type} onValueChange={(v) => setRows((prev) => prev.map((x) => x.id === r.id ? { ...x, type: v } : x))}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Select value={r.source ?? ""} onValueChange={(v) => setRows((prev) => prev.map((x) => x.id === r.id ? { ...x, source: v || null } : x))}>
                                <SelectTrigger><SelectValue placeholder="Select source" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="">— None —</SelectItem>
                                  {activeSources.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">Add sources below first</div>}
                                  {activeSources.map((s) => <SelectItem key={s.id} value={s.label}>{s.label}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell className="text-center">
                              <Switch checked={r.is_active} onCheckedChange={(v) => toggleActive(r, v)} />
                            </TableCell>
                            <TableCell className="text-right space-x-1">
                              <Button size="sm" variant="ghost" onClick={() => move(r, -1)} disabled={i === 0}><ArrowUp className="h-3.5 w-3.5" /></Button>
                              <Button size="sm" variant="ghost" onClick={() => move(r, 1)} disabled={i === catRows.length - 1}><ArrowDown className="h-3.5 w-3.5" /></Button>
                              <Button size="sm" onClick={() => save(r)}>Save</Button>
                              <Button size="sm" variant="destructive" onClick={() => remove(r.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                            </TableCell>
                          </TableRow>
                        ))}
                        {catRows.length === 0 && (
                          <TableRow><TableCell colSpan={9} className="text-center text-xs text-muted-foreground py-4">No targets yet in this category.</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              );
            })
          )}

          {/* ── Current Status Options ─────────────────────────── */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Current Status options</CardTitle>
              <p className="text-xs text-muted-foreground">
                Manage the available Current Status values (e.g. Not Started, In Progress). Officers select from this list when recording implementation status.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input placeholder="New status (e.g. Under Review)" value={newStatus} onChange={(e) => setNewStatus(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addStatusOption()} />
                <Button onClick={addStatusOption}><Plus className="h-3.5 w-3.5 mr-1" /> Add</Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-24 text-center">Active</TableHead>
                    <TableHead className="w-28 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {statusOptions.map((s) => (
                    <TableRow key={s.id} className={s.is_active ? "" : "opacity-50"}>
                      <TableCell className="text-sm">{s.label}</TableCell>
                      <TableCell className="text-center">
                        <Switch checked={s.is_active} onCheckedChange={(v) => toggleStatus(s, v)} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="destructive" onClick={() => removeStatusOption(s.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {statusOptions.length === 0 && (
                    <TableRow><TableCell colSpan={3} className="text-center text-xs text-muted-foreground py-6">No status options yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* ── Source dropdown values ────────────────────────── */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Source dropdown values</CardTitle>
              <p className="text-xs text-muted-foreground">
                Manage Sources (e.g. CIDP, Governor's Manifesto, ADP, Strategic Plan). Officers pick from this list when preparing Performance Contracts.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input placeholder="New source value (e.g. CIDP)" value={newSource} onChange={(e) => setNewSource(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addSource()} />
                <Button onClick={addSource}><Plus className="h-3.5 w-3.5 mr-1" /> Add</Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead className="w-24 text-center">Active</TableHead>
                    <TableHead className="w-32 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sources.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Input value={s.label} onBlur={(e) => updateSource(s, { label: e.target.value })}
                          onChange={(e) => setSources((prev) => prev.map((x) => x.id === s.id ? { ...x, label: e.target.value } : x))} />
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch checked={s.is_active} onCheckedChange={(v) => updateSource(s, { is_active: v })} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="destructive" onClick={() => removeSource(s.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {sources.length === 0 && (
                    <TableRow><TableCell colSpan={3} className="text-center text-xs text-muted-foreground py-6">No source values yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4 text-xs text-muted-foreground">
              <Label className="text-xs">Guidance</Label>
              <ul className="list-disc pl-5 mt-2 space-y-1">
                <li>Total <span className="font-medium">active</span> weight across all categories should equal 100.</li>
                <li>Each category's allocated weight must equal its Recommended Weight before a contract can be submitted.</li>
                <li>Deactivated targets and categories remain in record but are hidden from officers preparing new contracts.</li>
                <li>Deleting a category is only possible if it has no matrix targets assigned to it.</li>
              </ul>
            </CardContent>
          </Card>
        </main>

        {/* ── Category dialog ──────────────────────────────────── */}
        <Dialog open={catDialog.open} onOpenChange={(open) => setCatDialog((s) => ({ ...s, open }))}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{catDialog.editing ? "Edit Performance Category" : "Add Performance Category"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              {!catDialog.editing && (
                <div>
                  <Label className="text-xs">Category key <span className="text-muted-foreground">(unique identifier, e.g. core_mandate)</span></Label>
                  <Input value={catForm.category_key} onChange={(e) => setCatForm((s) => ({ ...s, category_key: e.target.value }))}
                    placeholder="e.g. cross_cutting" />
                </div>
              )}
              <div>
                <Label className="text-xs">Label <span className="text-destructive">*</span></Label>
                <Input value={catForm.label} onChange={(e) => setCatForm((s) => ({ ...s, label: e.target.value }))}
                  placeholder="e.g. Cross-Cutting Issues" />
              </div>
              <div>
                <Label className="text-xs">Recommended Weight <span className="text-destructive">*</span></Label>
                <Input type="number" min={0} max={100} value={catForm.recommended_weight}
                  onChange={(e) => setCatForm((s) => ({ ...s, recommended_weight: Number(e.target.value) }))} />
                <p className="text-[11px] text-muted-foreground mt-1">Officers' allocated weight in this category must equal this value.</p>
              </div>
              <div>
                <Label className="text-xs">Description</Label>
                <Input value={catForm.description} onChange={(e) => setCatForm((s) => ({ ...s, description: e.target.value }))}
                  placeholder="Brief description of this category" />
              </div>
              <div>
                <Label className="text-xs">Guidance (shown as tooltip to administrators)</Label>
                <Textarea rows={3} value={catForm.guidance} onChange={(e) => setCatForm((s) => ({ ...s, guidance: e.target.value }))}
                  placeholder="Explain the purpose, what to capture, examples of suitable targets, and guidance on assigning units, weights, types and sources." />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCatDialog({ open: false, editing: null })}>Cancel</Button>
              <Button onClick={saveCat}>{catDialog.editing ? "Save changes" : "Add category"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
