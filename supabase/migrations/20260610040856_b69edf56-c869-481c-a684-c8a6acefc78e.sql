
-- ============ DEPARTMENTS ============
CREATE TABLE public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.departments TO authenticated, anon;
GRANT ALL ON public.departments TO service_role;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "departments_read_all" ON public.departments FOR SELECT USING (true);
CREATE POLICY "departments_admin_write" ON public.departments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'system_admin') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'system_admin') OR public.has_role(auth.uid(),'super_admin'));

INSERT INTO public.departments(name) VALUES
  ('Agriculture'),('ICT'),('Finance'),('Health'),('Education'),
  ('Water'),('Trade & Industrialisation'),('Lands & Urban Planning'),
  ('Roads & Infrastructure'),('Public Service'),('Administration'),
  ('Tourism & Culture'),('Environment & Natural Resources'),
  ('Youth, Sports & Social Services'),('Office of the Governor')
ON CONFLICT DO NOTHING;

-- ============ USER_ROLES DEPARTMENT SCOPING ============
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS department text;
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_role_key;
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_uniq_idx
  ON public.user_roles(user_id, role, COALESCE(department,''));

-- ============ PROFILE HIERARCHY ============
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS directorate text,
  ADD COLUMN IF NOT EXISTS division text,
  ADD COLUMN IF NOT EXISTS supervisor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS director_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS chief_officer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ============ DEPT-SCOPED ROLE HELPER ============
CREATE OR REPLACE FUNCTION public.has_role_in_dept(_uid uuid, _role app_role, _dept text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.user_roles
    WHERE user_id=_uid AND role=_role
      AND (department IS NULL OR department=_dept)
  )
$$;
GRANT EXECUTE ON FUNCTION public.has_role_in_dept(uuid,app_role,text) TO authenticated;

-- ============ APPRAISAL CYCLES ============
CREATE TABLE public.appraisal_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fy_label text UNIQUE NOT NULL,
  fy_start date NOT NULL,
  fy_end date NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  governor_signed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  governor_signed_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.appraisal_cycles TO authenticated;
GRANT ALL ON public.appraisal_cycles TO service_role;
ALTER TABLE public.appraisal_cycles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cycles_read_all_auth" ON public.appraisal_cycles FOR SELECT TO authenticated USING (true);
CREATE POLICY "cycles_admin_write" ON public.appraisal_cycles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'system_admin') OR public.has_role(auth.uid(),'super_admin')
         OR public.has_role(auth.uid(),'governor'))
  WITH CHECK (public.has_role(auth.uid(),'system_admin') OR public.has_role(auth.uid(),'super_admin')
              OR public.has_role(auth.uid(),'governor'));
CREATE TRIGGER cycles_touch BEFORE UPDATE ON public.appraisal_cycles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ DEPT ACTIVATIONS ============
CREATE TABLE public.cycle_department_activations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES public.appraisal_cycles(id) ON DELETE CASCADE,
  department text NOT NULL,
  chief_officer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  chief_officer_signed_at timestamptz,
  director_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  director_signed_at timestamptz,
  supervisor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  supervisor_signed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(cycle_id, department)
);
GRANT SELECT ON public.cycle_department_activations TO authenticated;
GRANT ALL ON public.cycle_department_activations TO service_role;
ALTER TABLE public.cycle_department_activations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dept_act_read_all" ON public.cycle_department_activations FOR SELECT TO authenticated USING (true);
CREATE POLICY "dept_act_signers_write" ON public.cycle_department_activations FOR ALL TO authenticated
  USING (
    public.has_role_in_dept(auth.uid(),'chief_officer',department)
    OR public.has_role_in_dept(auth.uid(),'director',department)
    OR public.has_role_in_dept(auth.uid(),'supervisor',department)
    OR public.has_role(auth.uid(),'system_admin')
    OR public.has_role(auth.uid(),'super_admin')
  )
  WITH CHECK (
    public.has_role_in_dept(auth.uid(),'chief_officer',department)
    OR public.has_role_in_dept(auth.uid(),'director',department)
    OR public.has_role_in_dept(auth.uid(),'supervisor',department)
    OR public.has_role(auth.uid(),'system_admin')
    OR public.has_role(auth.uid(),'super_admin')
  );
CREATE TRIGGER dept_act_touch BEFORE UPDATE ON public.cycle_department_activations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ CYCLE-ACTIVE HELPER ============
CREATE OR REPLACE FUNCTION public.cycle_active_for_dept(_dept text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.appraisal_cycles c
    JOIN public.cycle_department_activations a ON a.cycle_id = c.id
    WHERE a.department = _dept
      AND c.governor_signed_at IS NOT NULL
      AND a.chief_officer_signed_at IS NOT NULL
      AND a.director_signed_at IS NOT NULL
      AND a.supervisor_signed_at IS NOT NULL
      AND c.status IN ('governor_signed','active')
  )
$$;
GRANT EXECUTE ON FUNCTION public.cycle_active_for_dept(text) TO authenticated;

-- ============ AUDIT LOGS ============
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email text,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  old_values jsonb,
  new_values jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_actor_idx ON public.audit_logs(actor_id, created_at DESC);
CREATE INDEX audit_logs_entity_idx ON public.audit_logs(entity_type, entity_id, created_at DESC);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_admin_read" ON public.audit_logs FOR SELECT TO authenticated
  USING (public.is_admin_viewer(auth.uid()));
CREATE POLICY "audit_self_insert" ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid());

CREATE OR REPLACE FUNCTION public.log_audit(
  _action text, _entity_type text DEFAULT NULL, _entity_id text DEFAULT NULL,
  _old jsonb DEFAULT NULL, _new jsonb DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.audit_logs(actor_id, actor_email, action, entity_type, entity_id, old_values, new_values)
  VALUES (
    auth.uid(),
    (SELECT email FROM public.profiles WHERE id = auth.uid()),
    _action, _entity_type, _entity_id, _old, _new
  );
END $$;
GRANT EXECUTE ON FUNCTION public.log_audit(text,text,text,jsonb,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.audit_user_roles() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, new_values)
    VALUES (auth.uid(),'role_granted','user_roles', NEW.user_id::text,
            jsonb_build_object('role',NEW.role,'department',NEW.department));
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, old_values)
    VALUES (auth.uid(),'role_revoked','user_roles', OLD.user_id::text,
            jsonb_build_object('role',OLD.role,'department',OLD.department));
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER trg_audit_user_roles
  AFTER INSERT OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.audit_user_roles();

-- ============ SUPER26 BOOTSTRAP ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, employee_no, designation, department)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'employee_no', 'BGM-' || substr(NEW.id::text,1,6)),
    COALESCE(NEW.raw_user_meta_data->>'designation', 'Officer'),
    COALESCE(NEW.raw_user_meta_data->>'department', 'Administration')
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'employee');
  IF lower(NEW.email) IN ('super@bungoma.go.ke','super26@bungoma.go.ke') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'super_admin') ON CONFLICT DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'system_admin') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
