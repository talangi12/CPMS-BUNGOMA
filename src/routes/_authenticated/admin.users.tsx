import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useRoles, hasAnyRole, ROLE_LABELS, type AppRole } from "@/hooks/useRoles";
import { ShieldCheck, UserPlus, CheckCircle2 } from "lucide-react";
import { createUserWithRole } from "@/lib/admin.functions";


export const Route = createFileRoute("/_authenticated/admin/users")({
  head: () => ({ meta: [{ title: "Admin · New User — Bungoma CPMS" }] }),
  component: AdminUsers,
});

const ROLES: AppRole[] = [
  "employee", "supervisor", "external_assessor", "hr", "system_admin", "super_admin",
  "appeals_committee", "governor", "cec", "chief_officer", "director",
];

const STATUSES = [
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "archived", label: "Archived" },
  { value: "terminated", label: "Terminated" },
] as const;

type FormState = {
  id_number: string;
  personal_number: string;
  full_name: string;
  email: string;
  phone: string;
  department: string;
  directorate: string;
  section: string;
  designation: string;
  role: AppRole;
  role_department: string;
  employee_status: typeof STATUSES[number]["value"];
  password: string;
};

const EMPTY: FormState = {
  id_number: "", personal_number: "", full_name: "", email: "", phone: "",
  department: "", directorate: "", section: "", designation: "",
  role: "employee", role_department: "", employee_status: "active",
  password: "BUNGOMA*039",
};

function AdminUsers() {
  const { user } = Route.useRouteContext();
  const { data: roles, isLoading } = useRoles(user.id);
  const allowed = hasAnyRole(roles, ["system_admin", "super_admin"]);
  const isSuper = hasAnyRole(roles, ["super_admin"]);
  const createFn = useServerFn(createUserWithRole);
  const qc = useQueryClient();

  const { data: departments = [] } = useQuery({
  queryKey: ["departments-from-org"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("org_units")
      .select("department");

    if (error) throw error;

    return Array.from(
      new Set(
        (data ?? [])
          .map((r) => r.department)
          .filter(Boolean)
      )
    ).sort();
  },
});

  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [lastCreated, setLastCreated] = useState<{ id_number: string; personal_number: string } | null>(null);

  // Keep role_department in sync with department by default
  useEffect(() => {
    if (form.role !== "employee" && !form.role_department) {
      setForm((f) => ({ ...f, role_department: f.department }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.department]);


  if (!isLoading && !allowed) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader authenticated userId={user.id} />
        <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <Card className="p-10 text-center">
            <ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground" />
            <h1 className="mt-3 font-display text-2xl font-bold">Admins only</h1>
          </Card>
        </main>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLastCreated(null);
    try {
      const res = await createFn({ data: form });
      toast.success(`Account created. They can sign in immediately with National ID ${res.login_id} or Payroll Number ${res.login_personal_no}.`);
      setLastCreated({ id_number: res.login_id, personal_number: res.login_personal_no });
      setForm(EMPTY);
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const assignable = isSuper ? ROLES : ROLES.filter((r) => r !== "super_admin");
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="min-h-screen bg-background">
      <AppHeader authenticated userId={user.id} />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-primary">Administration</div>
          <h1 className="mt-2 font-display text-3xl font-bold flex items-center gap-2">
            <UserPlus className="h-7 w-7 text-primary" /> Create user account
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Captures the full employee record, registers them in the database, and gives them immediate access. Users sign in with their <strong>National ID</strong> or <strong>Payroll/Personal Number</strong> — no forced password change.
          </p>
        </div>

        {lastCreated && (
          <Card className="mt-6 border-primary/40 bg-primary/5 p-4">
            <div className="flex items-start gap-2 text-sm">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
              <div>
                <div className="font-semibold text-primary">Account active</div>
                <div className="mt-1 text-xs">
                  Login: <span className="font-mono">{lastCreated.id_number}</span> or <span className="font-mono">{lastCreated.personal_number}</span> — temporary password as set above.
                </div>
              </div>
            </div>
          </Card>
        )}

        <Card className="mt-6 p-6">
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <Field label="National ID number *">
              <Input required value={form.id_number} onChange={(e) => set("id_number", e.target.value)} placeholder="e.g. 23456789" />
            </Field>
            <Field label="Payroll / Personal number *">
              <Input required value={form.personal_number} onChange={(e) => set("personal_number", e.target.value)} placeholder="e.g. 100123" />
            </Field>
            <Field label="Full name (three names) *">
              <Input required value={form.full_name} onChange={(e) => set("full_name", e.target.value)} placeholder="e.g. John Otieno Wanjala" />
            </Field>
            <Field label="Email address *">
              <Input type="email" required value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="name@bungoma.go.ke" />
            </Field>
            <Field label="Phone number *">
              <Input required value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="07XX XXX XXX" />
            </Field>
            <Field label="Designation *">
              <Input required value={form.designation} onChange={(e) => set("designation", e.target.value)} placeholder="e.g. Senior Accountant" />
            </Field>
            <Field label="Department *">
              <Select value={form.department} onValueChange={(v) => set("department", v)}>
                <SelectTrigger><SelectValue placeholder={departments.length ? "Select department" : "No active departments configured"} /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
              {!form.department && <p className="mt-1 text-[10px] text-muted-foreground">Loaded from the master Department table. Manage departments under Admin → Org Structure.</p>}
            </Field>

            <Field label="Directorate">
              <Input value={form.directorate} onChange={(e) => set("directorate", e.target.value)} placeholder="e.g. Medical Services" />
            </Field>
            <Field label="Section / Unit">
              <Input value={form.section} onChange={(e) => set("section", e.target.value)} placeholder="optional" />
            </Field>
            <Field label="Assigned role *">
              <Select value={form.role} onValueChange={(v) => set("role", v as AppRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {assignable.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            {form.role !== "employee" && (
              <Field label="Role scoped to department (defaults to department)">
                <Select value={form.role_department || form.department} onValueChange={(v) => set("role_department", v)}>
                  <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            )}

            <Field label="Employment status *">
              <Select value={form.employee_status} onValueChange={(v) => set("employee_status", v as FormState["employee_status"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Temporary password *">
              <Input type="text" required minLength={6} value={form.password} onChange={(e) => set("password", e.target.value)} />
            </Field>
            <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
              <Link to="/admin/roles"><Button type="button" variant="outline">Manage existing roles</Button></Link>
              <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create user"}</Button>
            </div>
          </form>
        </Card>

        <p className="mt-4 text-[11px] text-muted-foreground">
          Duplicate National IDs, Payroll Numbers, and email addresses are rejected. Accounts remain active until a System Administrator archives or deactivates them via <Link to="/admin/status" className="underline">Status management</Link>.
        </p>
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1.5 block text-xs">{label}</Label>
      {children}
    </div>
  );
}
