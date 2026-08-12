 
-- ============ Helper: touch_updated_at ============
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ============ Helper: log_audit ============
CREATE OR REPLACE FUNCTION public.log_audit(
  _action text,
  _entity_type text,
  _entity_id text DEFAULT NULL,
  _old_values jsonb DEFAULT NULL,
  _new_values jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_logs(actor_id, actor_email, action, entity_type, entity_id, old_values, new_values)
  VALUES (auth.uid(), (SELECT email FROM auth.users WHERE id=auth.uid()), _action, _entity_type, _entity_id, _old_values, _new_values);
END $$;

-- ============ Helper: has_role_in_dept ============
CREATE OR REPLACE FUNCTION public.has_role_in_dept(_user_id uuid, _role text, _dept text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS(
    SELECT 1 FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.user_id = _user_id
      AND ur.role::text = _role
      AND lower(coalesce(p.department,'')) = lower(coalesce(_dept,''))
  );
END $$;

CREATE OR REPLACE FUNCTION public.can_sign_as_supervisor(_actor uuid, _employee uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  emp_dept text; emp_dir text;
  actor_dept text; actor_dir text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.appraisals
             WHERE employee_id = _employee AND chosen_supervisor_id = _actor) THEN
    RETURN true;
  END IF;
  SELECT department, directorate INTO emp_dept, emp_dir
    FROM public.profiles WHERE id = _employee;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _actor AND role = 'director') THEN
    SELECT department, directorate INTO actor_dept, actor_dir
      FROM public.profiles WHERE id = _actor;
    IF lower(coalesce(actor_dept,'')) = lower(coalesce(emp_dept,''))
       AND lower(coalesce(actor_dir,'')) = lower(coalesce(emp_dir,'')) THEN
      RETURN true;
    END IF;
  END IF;
  RETURN false;
END $$;

-- ============ Helper: current_quarter ============
CREATE OR REPLACE FUNCTION public.current_quarter(_fy_start date)
RETURNS smallint
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _fy_start IS NULL THEN NULL
    WHEN now() < _fy_start THEN NULL
    WHEN now() < _fy_start + interval '3 months' THEN 1::smallint
    WHEN now() < _fy_start + interval '6 months' THEN 2::smallint
    WHEN now() < _fy_start + interval '9 months' THEN 3::smallint
    WHEN now() < _fy_start + interval '12 months' THEN 4::smallint
    ELSE 4::smallint
  END
$$;

CREATE TYPE public.app_role AS ENUM (
  'employee','supervisor','department_head','hr_officer','cpmc','board','chief_officer','county_administrator','admin','super_admin'
);

-- ============ Core Tables (required by references below) ============

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id),
  actor_email text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON public.audit_logs(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS public.appraisal_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fy_label text NOT NULL UNIQUE,
  fy_start date NOT NULL,
  fy_end date NOT NULL,
  name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.appraisal_cycles TO authenticated;
GRANT ALL ON public.appraisal_cycles TO service_role;
ALTER TABLE public.appraisal_cycles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cycles readable" ON public.appraisal_cycles FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.appraisals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cycle_id uuid REFERENCES public.appraisal_cycles(id),
  chosen_supervisor_id uuid REFERENCES auth.users(id),
  period text,
  status text NOT NULL DEFAULT 'draft',
  total_score numeric(6,2),
  rating text,
  rejection_reason text,
  employee_signed_at timestamptz,
  supervisor_reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.appraisals TO authenticated;
GRANT ALL ON public.appraisals TO service_role;
ALTER TABLE public.appraisals ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS appraisals_employee_idx ON public.appraisals(employee_id);
CREATE INDEX IF NOT EXISTS appraisals_status_idx ON public.appraisals(status);

CREATE TABLE IF NOT EXISTS public.targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appraisal_id uuid REFERENCES public.appraisals(id) ON DELETE CASCADE,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.targets TO authenticated;
GRANT ALL ON public.targets TO service_role;
ALTER TABLE public.targets ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text,
  body text,
  link text,
  related_appraisal_id uuid REFERENCES public.appraisals(id) ON DELETE SET NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own notifications" ON public.notifications FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE INDEX IF NOT EXISTS notifications_user_idx ON public.notifications(user_id);

CREATE TABLE IF NOT EXISTS public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  code text UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.departments TO authenticated;
GRANT ALL ON public.departments TO service_role;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "depts readable" ON public.departments FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_admin_viewer(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _uid
      AND role::text IN ('hr','system_admin','super_admin','hr_officer','admin')
  )
$$;

GRANT EXECUTE ON FUNCTION public.is_admin_viewer(uuid) TO authenticated;

-- ============ Helper: can_view_profile (depends on is_admin_viewer and can_sign_as_supervisor) ============
CREATE OR REPLACE FUNCTION public.can_view_profile(_viewer uuid, _profile_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _viewer = _profile_user_id THEN RETURN true; END IF;
  IF public.is_admin_viewer(_viewer) THEN RETURN true; END IF;
  IF public.can_sign_as_supervisor(_viewer, _profile_user_id) THEN RETURN true; END IF;
  RETURN false;
END $$;
GRANT EXECUTE ON FUNCTION public.can_view_profile(uuid, uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_no text UNIQUE,
  national_id text,
  full_name text NOT NULL,
  email text,
  phone text,
  designation text,
  job_group text,
  department text,
  directorate text,
  work_station text,
  supervisor_id uuid REFERENCES public.profiles(id),
  employment_status text DEFAULT 'active',
  employment_date date,
  photo_url text,
  section text,
  unit text,
  employment_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- ─────────────────────────────────────────────────────────────
-- Migration: 20260615054523_ebfeb169-1046-4a19-9117-152f9890f7e1.sql
-- ─────────────────────────────────────────────────────────────

-- ORG UNITS
CREATE TABLE public.org_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  directorate text,
  department text NOT NULL,
  section text,
  unit text,
  employee_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (directorate, department, section, unit)
);
GRANT SELECT ON public.org_units TO authenticated;
GRANT ALL ON public.org_units TO service_role;
ALTER TABLE public.org_units ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated reads org units" ON public.org_units FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage org units" ON public.org_units FOR ALL TO authenticated USING (public.is_admin_viewer(auth.uid())) WITH CHECK (public.is_admin_viewer(auth.uid()));

-- SYNC LOGS
CREATE TABLE public.sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  status text NOT NULL,
  processed integer NOT NULL DEFAULT 0,
  created integer NOT NULL DEFAULT 0,
  updated integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  details jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX sync_logs_started_idx ON public.sync_logs(started_at DESC);
GRANT SELECT ON public.sync_logs TO authenticated;
GRANT ALL ON public.sync_logs TO service_role;
ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read sync logs" ON public.sync_logs FOR SELECT TO authenticated USING (public.is_admin_viewer(auth.uid()));

-- SYNC SCHEDULE (single-row preferences)
CREATE TABLE public.sync_schedule (
  id integer PRIMARY KEY DEFAULT 1,
  frequency text NOT NULL DEFAULT 'manual',
  endpoint_url text,
  last_run_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT one_row CHECK (id = 1),
  CONSTRAINT freq_valid CHECK (frequency IN ('manual','daily','weekly'))
);
INSERT INTO public.sync_schedule (id, frequency) VALUES (1, 'manual') ON CONFLICT DO NOTHING;
GRANT SELECT ON public.sync_schedule TO authenticated;
GRANT ALL ON public.sync_schedule TO service_role;
ALTER TABLE public.sync_schedule ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read sync schedule" ON public.sync_schedule FOR SELECT TO authenticated USING (public.is_admin_viewer(auth.uid()));
CREATE POLICY "Admins update sync schedule" ON public.sync_schedule FOR UPDATE TO authenticated USING (public.is_admin_viewer(auth.uid())) WITH CHECK (public.is_admin_viewer(auth.uid()));

-- Add section / unit / employment_type to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS section text,
  ADD COLUMN IF NOT EXISTS unit text,
  ADD COLUMN IF NOT EXISTS employment_type text;

-- Trigger to upsert org_units when profile changes
CREATE OR REPLACE FUNCTION public.sync_org_unit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.department IS NULL OR NEW.department = '' THEN RETURN NEW; END IF;
  INSERT INTO public.org_units (directorate, department, section, unit, employee_count)
  VALUES (COALESCE(NEW.directorate,''), NEW.department, COALESCE(NEW.section,''), COALESCE(NEW.unit,''), 1)
  ON CONFLICT (directorate, department, section, unit)
  DO UPDATE SET employee_count = public.org_units.employee_count + 1, updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_org_unit ON public.profiles;
CREATE TRIGGER trg_sync_org_unit
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_org_unit();

-- Initial backfill of org_units from existing profiles
INSERT INTO public.org_units (directorate, department, section, unit, employee_count)
SELECT COALESCE(directorate,''), department, COALESCE(section,''), COALESCE(unit,''), COUNT(*)
FROM public.profiles
WHERE department IS NOT NULL AND department <> ''
GROUP BY 1,2,3,4
ON CONFLICT (directorate, department, section, unit) DO UPDATE SET employee_count = EXCLUDED.employee_count, updated_at = now();

-- ai_reports table to store generated narrative reports
CREATE TABLE public.ai_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appraisal_id uuid NOT NULL REFERENCES public.appraisals(id) ON DELETE CASCADE,
  generated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  model text NOT NULL,
  narrative text NOT NULL,
  metrics jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_reports_appraisal_idx ON public.ai_reports(appraisal_id, created_at DESC);
GRANT SELECT, INSERT ON public.ai_reports TO authenticated;
GRANT ALL ON public.ai_reports TO service_role;
ALTER TABLE public.ai_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Employees view own reports" ON public.ai_reports FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.appraisals a WHERE a.id = appraisal_id
            AND (a.employee_id = auth.uid() OR a.chosen_supervisor_id = auth.uid() OR public.is_admin_viewer(auth.uid())))
  );
CREATE POLICY "Admins/supervisors insert reports" ON public.ai_reports FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.appraisals a WHERE a.id = appraisal_id
            AND (a.chosen_supervisor_id = auth.uid() OR public.is_admin_viewer(auth.uid())))
  );


-- ─────────────────────────────────────────────────────────────
-- Migration: 20260616161045_efe4a0d8-b9fa-47f2-9013-dda3ba607cfd.sql
-- ─────────────────────────────────────────────────────────────

-- ============== ENUMS ==============
DO $$ BEGIN
  CREATE TYPE public.employment_type AS ENUM ('permanent','pensionable','contract','casual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.employee_status AS ENUM ('active','archived','on_leave','suspended','transferred','retired','terminated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============== PROFILES additions ==============
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone_number text,
  ADD COLUMN IF NOT EXISTS employment_type public.employment_type NOT NULL DEFAULT 'permanent',
  ADD COLUMN IF NOT EXISTS contract_start_date date,
  ADD COLUMN IF NOT EXISTS contract_end_date date,
  ADD COLUMN IF NOT EXISTS employee_status public.employee_status NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_changed_by uuid,
  ADD COLUMN IF NOT EXISTS status_change_reason text;

CREATE INDEX IF NOT EXISTS profiles_phone_idx ON public.profiles(phone_number);
CREATE INDEX IF NOT EXISTS profiles_employment_type_idx ON public.profiles(employment_type);
CREATE INDEX IF NOT EXISTS profiles_employee_status_idx ON public.profiles(employee_status);
CREATE INDEX IF NOT EXISTS profiles_contract_end_idx ON public.profiles(contract_end_date);

-- ============== OTP CODES ==============
CREATE TABLE IF NOT EXISTS public.otp_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  id_number text NOT NULL,
  phone_number text NOT NULL,
  code_hash text NOT NULL,
  attempts smallint NOT NULL DEFAULT 0,
  max_attempts smallint NOT NULL DEFAULT 3,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.otp_codes TO authenticated;
GRANT ALL ON public.otp_codes TO service_role;
ALTER TABLE public.otp_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "otp self read" ON public.otp_codes FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin_viewer(auth.uid()));
CREATE INDEX IF NOT EXISTS otp_idn_idx ON public.otp_codes(id_number, created_at DESC);

-- ============== EMPLOYEE STATUS HISTORY ==============
CREATE TABLE IF NOT EXISTS public.employee_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  previous_status public.employee_status,
  new_status public.employee_status NOT NULL,
  reason text,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.employee_status_history TO authenticated;
GRANT ALL ON public.employee_status_history TO service_role;
ALTER TABLE public.employee_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "status hist read" ON public.employee_status_history FOR SELECT TO authenticated
  USING (employee_id = auth.uid() OR public.is_admin_viewer(auth.uid()));
CREATE POLICY "status hist admin insert" ON public.employee_status_history FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_viewer(auth.uid()));
CREATE INDEX IF NOT EXISTS esh_emp_idx ON public.employee_status_history(employee_id, changed_at DESC);

-- ============== APPRAISAL VERSIONS ==============
CREATE TABLE IF NOT EXISTS public.appraisal_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appraisal_id uuid NOT NULL,
  version_no int NOT NULL,
  snapshot jsonb NOT NULL,
  changed_by uuid,
  change_summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.appraisal_versions TO authenticated;
GRANT ALL ON public.appraisal_versions TO service_role;
ALTER TABLE public.appraisal_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "av read" ON public.appraisal_versions FOR SELECT TO authenticated
  USING (
    public.is_admin_viewer(auth.uid()) OR EXISTS (
      SELECT 1 FROM public.appraisals a WHERE a.id = appraisal_id
      AND (a.employee_id = auth.uid() OR a.chosen_supervisor_id = auth.uid())
    )
  );
CREATE POLICY "av insert" ON public.appraisal_versions FOR INSERT TO authenticated
  WITH CHECK (changed_by = auth.uid());
CREATE INDEX IF NOT EXISTS av_appr_idx ON public.appraisal_versions(appraisal_id, version_no DESC);

-- ============== APPRAISALS escalation columns ==============
ALTER TABLE public.appraisals
  ADD COLUMN IF NOT EXISTS supervisor_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalated_to uuid,
  ADD COLUMN IF NOT EXISTS escalation_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz;

-- When a submission happens, set the 72h deadline.
CREATE OR REPLACE FUNCTION public.set_supervisor_deadline()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status = 'submitted' AND (OLD.status IS DISTINCT FROM 'submitted') THEN
    NEW.supervisor_deadline := now() + interval '72 hours';
    NEW.escalated_at := NULL;
    NEW.escalated_to := NULL;
  END IF;
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    NEW.locked_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_set_supervisor_deadline ON public.appraisals;
CREATE TRIGGER trg_set_supervisor_deadline
  BEFORE UPDATE ON public.appraisals
  FOR EACH ROW EXECUTE FUNCTION public.set_supervisor_deadline();

-- ============== Escalate-on-read helper ==============
CREATE OR REPLACE FUNCTION public.escalate_overdue_appraisals()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  r record;
  co_user uuid;
  emp_dept text;
  emp_name text;
  cnt int := 0;
BEGIN
  FOR r IN
    SELECT a.id, a.employee_id, a.chosen_supervisor_id, a.period
    FROM public.appraisals a
    WHERE a.status='submitted'
      AND a.supervisor_deadline IS NOT NULL
      AND now() > a.supervisor_deadline
      AND a.escalated_at IS NULL
  LOOP
    SELECT department, full_name INTO emp_dept, emp_name FROM public.profiles WHERE id = r.employee_id;
    -- find a chief officer in that department
    SELECT ur.user_id INTO co_user
      FROM public.user_roles ur
      JOIN public.profiles p ON p.id = ur.user_id
      WHERE ur.role = 'chief_officer'
        AND lower(coalesce(p.department,'')) = lower(coalesce(emp_dept,''))
      LIMIT 1;
    UPDATE public.appraisals
      SET escalated_at = now(),
          escalated_to = co_user,
          escalation_count = escalation_count + 1
      WHERE id = r.id;
    IF co_user IS NOT NULL THEN
      INSERT INTO public.notifications(user_id, type, title, body, link, related_appraisal_id)
      VALUES (co_user, 'appraisal_escalated',
              'Appraisal escalated to your office',
              COALESCE(emp_name,'An employee') || '''s ' || r.period || ' appraisal was not actioned within 72 hours and has been escalated to you.',
              '/supervisor/review/' || r.id::text,
              r.id);
    END IF;
    cnt := cnt + 1;
  END LOOP;
  RETURN cnt;
END $$;
GRANT EXECUTE ON FUNCTION public.escalate_overdue_appraisals() TO authenticated;

-- ============== Archive expired contracts ==============
CREATE OR REPLACE FUNCTION public.archive_expired_contracts()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cnt int := 0; r record;
BEGIN
  FOR r IN
    SELECT id, employee_status FROM public.profiles
    WHERE employment_type IN ('contract','casual')
      AND contract_end_date IS NOT NULL
      AND contract_end_date < current_date
      AND employee_status = 'active'
  LOOP
    INSERT INTO public.employee_status_history(employee_id, previous_status, new_status, reason, changed_by)
    VALUES (r.id, r.employee_status, 'archived', 'Auto-archived: contract expired', NULL);
    UPDATE public.profiles
      SET employee_status='archived',
          status_changed_at=now(),
          status_change_reason='Auto-archived: contract end date passed'
      WHERE id = r.id;
    cnt := cnt + 1;
  END LOOP;
  RETURN cnt;
END $$;
GRANT EXECUTE ON FUNCTION public.archive_expired_contracts() TO authenticated;

-- ============== Status change RPC (system admin only) ==============
CREATE OR REPLACE FUNCTION public.change_employee_status(_employee uuid, _new public.employee_status, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  is_sys boolean;
  prev public.employee_status;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role IN ('system_admin','super_admin','director','supervisor'))
    INTO is_sys;
  IF NOT is_sys THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT employee_status INTO prev FROM public.profiles WHERE id=_employee;
  IF prev IS NULL THEN RAISE EXCEPTION 'Employee not found'; END IF;
  UPDATE public.profiles
    SET employee_status=_new,
        status_changed_at=now(),
        status_changed_by=auth.uid(),
        status_change_reason=_reason
    WHERE id=_employee;
  INSERT INTO public.employee_status_history(employee_id, previous_status, new_status, reason, changed_by)
    VALUES (_employee, prev, _new, _reason, auth.uid());
  PERFORM public.log_audit('employee_status_changed','profiles',_employee::text,
    jsonb_build_object('status',prev), jsonb_build_object('status',_new,'reason',_reason));
END $$;
GRANT EXECUTE ON FUNCTION public.change_employee_status(uuid, public.employee_status, text) TO authenticated;

-- ============== Contract action RPC ==============
CREATE OR REPLACE FUNCTION public.contract_action(_employee uuid, _action text, _new_end date, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE allowed boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid()
                AND role IN ('system_admin','super_admin','director','supervisor'))
    INTO allowed;
  IF NOT allowed THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _action IN ('restore') THEN
    UPDATE public.profiles SET employee_status='active', status_changed_at=now(),
      status_changed_by=auth.uid(), status_change_reason=COALESCE(_reason,'Restored')
      WHERE id=_employee;
    INSERT INTO public.employee_status_history(employee_id,previous_status,new_status,reason,changed_by)
      VALUES (_employee,'archived','active',COALESCE(_reason,'Restored'),auth.uid());
  ELSIF _action IN ('renew','extend') THEN
    IF _new_end IS NULL THEN RAISE EXCEPTION 'new end date required'; END IF;
    UPDATE public.profiles
      SET contract_end_date=_new_end, employee_status='active',
          status_changed_at=now(), status_changed_by=auth.uid(),
          status_change_reason=COALESCE(_reason, _action||' to '||_new_end::text)
      WHERE id=_employee;
    INSERT INTO public.employee_status_history(employee_id,previous_status,new_status,reason,changed_by)
      VALUES (_employee,'archived','active',_action||' to '||_new_end::text,auth.uid());
  ELSIF _action = 'terminate' THEN
    UPDATE public.profiles SET employee_status='terminated', status_changed_at=now(),
      status_changed_by=auth.uid(), status_change_reason=COALESCE(_reason,'Terminated')
      WHERE id=_employee;
    INSERT INTO public.employee_status_history(employee_id,previous_status,new_status,reason,changed_by)
      VALUES (_employee,'archived','terminated',COALESCE(_reason,'Terminated'),auth.uid());
  ELSE
    RAISE EXCEPTION 'Unknown action %', _action;
  END IF;
  PERFORM public.log_audit('contract_'||_action,'profiles',_employee::text,NULL,
    jsonb_build_object('reason',_reason,'new_end',_new_end));
END $$;
GRANT EXECUTE ON FUNCTION public.contract_action(uuid,text,date,text) TO authenticated;


-- ─────────────────────────────────────────────────────────────
-- Migration: 20260617061956_e297d588-32f6-4ebe-a1b9-d7879941a56f.sql
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.notification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL,
  recipient text NOT NULL,
  recipient_user_id uuid,
  event_type text NOT NULL,
  subject text,
  body text,
  status text NOT NULL DEFAULT 'pending',
  provider text,
  provider_response text,
  error text,
  related_appraisal_id uuid,
  related_employee_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

GRANT SELECT ON public.notification_log TO authenticated;
GRANT ALL ON public.notification_log TO service_role;

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view notification log"
ON public.notification_log FOR SELECT
TO authenticated
USING (public.is_admin_viewer(auth.uid()));

CREATE INDEX IF NOT EXISTS notification_log_created_idx ON public.notification_log(created_at DESC);
CREATE INDEX IF NOT EXISTS notification_log_event_idx ON public.notification_log(event_type);

-- Extend escalation to write audit entries
CREATE OR REPLACE FUNCTION public.escalate_overdue_appraisals()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r record; co_user uuid; emp_dept text; emp_name text; cnt int := 0;
BEGIN
  FOR r IN
    SELECT a.id, a.employee_id, a.chosen_supervisor_id, a.period
    FROM public.appraisals a
    WHERE a.status='submitted' AND a.supervisor_deadline IS NOT NULL
      AND now() > a.supervisor_deadline AND a.escalated_at IS NULL
  LOOP
    SELECT department, full_name INTO emp_dept, emp_name FROM public.profiles WHERE id = r.employee_id;
    SELECT ur.user_id INTO co_user
      FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
      WHERE ur.role = 'chief_officer'
        AND lower(coalesce(p.department,'')) = lower(coalesce(emp_dept,''))
      LIMIT 1;
    UPDATE public.appraisals SET escalated_at=now(), escalated_to=co_user, escalation_count=escalation_count+1 WHERE id=r.id;
    IF co_user IS NOT NULL THEN
      INSERT INTO public.notifications(user_id, type, title, body, link, related_appraisal_id)
      VALUES (co_user, 'appraisal_escalated', 'Appraisal escalated to your office',
              COALESCE(emp_name,'An employee') || '''s ' || r.period || ' appraisal was not actioned within 72 hours and has been escalated to you.',
              '/supervisor/review/' || r.id::text, r.id);
    END IF;
    INSERT INTO public.audit_logs(action, entity_type, entity_id, new_values)
    VALUES ('appraisal_escalated','appraisals', r.id::text,
      jsonb_build_object('employee', emp_name, 'department', emp_dept, 'escalated_to', co_user));
    cnt := cnt + 1;
  END LOOP;
  RETURN cnt;
END $$;

-- Monitor contracts: archive expired and return rich payload + log audit
CREATE OR REPLACE FUNCTION public.monitor_contracts()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  archived_count int := 0;
  expiring_soon int := 0;
  r record;
BEGIN
  FOR r IN
    SELECT id, full_name, department, employee_status
    FROM public.profiles
    WHERE employment_type IN ('contract','casual')
      AND contract_end_date IS NOT NULL
      AND contract_end_date < current_date
      AND employee_status = 'active'
  LOOP
    INSERT INTO public.employee_status_history(employee_id, previous_status, new_status, reason, changed_by)
    VALUES (r.id, r.employee_status, 'archived', 'Auto-archived by background job: contract expired', NULL);
    UPDATE public.profiles
      SET employee_status='archived', status_changed_at=now(),
          status_change_reason='Auto-archived: contract end date passed'
      WHERE id = r.id;
    INSERT INTO public.audit_logs(action, entity_type, entity_id, new_values)
    VALUES ('contract_auto_archived','profiles', r.id::text,
      jsonb_build_object('name', r.full_name, 'department', r.department, 'job','contract-monitor'));
    archived_count := archived_count + 1;
  END LOOP;

  SELECT count(*) INTO expiring_soon
  FROM public.profiles
  WHERE employment_type IN ('contract','casual')
    AND contract_end_date IS NOT NULL
    AND contract_end_date BETWEEN current_date AND (current_date + interval '30 days')
    AND employee_status = 'active';

  INSERT INTO public.audit_logs(action, entity_type, new_values)
  VALUES ('contract_monitor_run','system',
    jsonb_build_object('archived', archived_count, 'expiring_in_30_days', expiring_soon, 'at', now()));

  RETURN jsonb_build_object('archived', archived_count, 'expiring_soon', expiring_soon);
END $$;

GRANT EXECUTE ON FUNCTION public.monitor_contracts() TO authenticated, service_role, anon;


-- ─────────────────────────────────────────────────────────────
-- Migration: 20260617062232_88f27dee-f2a3-4c79-b248-51ff8e5dcab6.sql
-- ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron; CREATE EXTENSION IF NOT EXISTS pg_net;

-- ─────────────────────────────────────────────────────────────
-- Migration: 20260622105818_c4c37a15-e567-4423-9eb8-a2424ef4a732.sql
-- ─────────────────────────────────────────────────────────────

-- 1. Revision/reminder tracking columns
ALTER TABLE public.appraisals
  ADD COLUMN IF NOT EXISTS returns_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resubmissions_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS returned_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_reminder_24h_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_reminder_48h_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_reminder_60h_at timestamptz;

CREATE INDEX IF NOT EXISTS appraisals_status_deadline_idx
  ON public.appraisals(status, supervisor_deadline)
  WHERE status = 'submitted';

-- 2. Update deadline trigger so resubmissions reset & increment counters,
--    and returns stop the timer.
CREATE OR REPLACE FUNCTION public.set_supervisor_deadline()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'submitted' AND (OLD.status IS DISTINCT FROM 'submitted') THEN
    NEW.supervisor_deadline := now() + interval '72 hours';
    NEW.escalated_at := NULL;
    NEW.escalated_to := NULL;
    NEW.last_reminder_24h_at := NULL;
    NEW.last_reminder_48h_at := NULL;
    NEW.last_reminder_60h_at := NULL;
    IF OLD.status = 'rejected' THEN
      NEW.resubmissions_count := COALESCE(OLD.resubmissions_count,0) + 1;
    END IF;
  END IF;
  IF NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected' THEN
    NEW.returns_count := COALESCE(OLD.returns_count,0) + 1;
    NEW.returned_at := now();
    NEW.supervisor_deadline := NULL;
    NEW.escalated_at := NULL;
    NEW.escalated_to := NULL;
  END IF;
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    NEW.locked_at := now();
  END IF;
  RETURN NEW;
END $$;

-- 3. Reminder processor — called by /api/public/hooks/appraisal-reminders
CREATE OR REPLACE FUNCTION public.process_appraisal_reminders()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  hours_elapsed numeric;
  remaining_h numeric;
  emp record;
  stage text;
  msg text;
  cnt_24 int := 0; cnt_48 int := 0; cnt_60 int := 0;
BEGIN
  FOR r IN
    SELECT a.id, a.employee_id, a.period, a.supervisor_deadline, a.chosen_supervisor_id, a.escalated_to,
           a.last_reminder_24h_at, a.last_reminder_48h_at, a.last_reminder_60h_at
    FROM public.appraisals a
    WHERE a.status = 'submitted'
      AND a.supervisor_deadline IS NOT NULL
      AND a.escalated_at IS NULL
      AND a.chosen_supervisor_id IS NOT NULL
  LOOP
    hours_elapsed := EXTRACT(epoch FROM (now() - (r.supervisor_deadline - interval '72 hours'))) / 3600.0;
    remaining_h := EXTRACT(epoch FROM (r.supervisor_deadline - now())) / 3600.0;
    SELECT full_name, employee_no, department INTO emp FROM public.profiles WHERE id = r.employee_id;

    stage := NULL;
    IF hours_elapsed >= 60 AND r.last_reminder_60h_at IS NULL THEN stage := '60h';
    ELSIF hours_elapsed >= 48 AND r.last_reminder_48h_at IS NULL THEN stage := '48h';
    ELSIF hours_elapsed >= 24 AND r.last_reminder_24h_at IS NULL THEN stage := '24h';
    END IF;

    IF stage IS NULL THEN CONTINUE; END IF;

    msg := format(
      'Pending appraisal review — %s (Emp %s, %s). Submitted %s. ~%s hours remain before escalation.',
      COALESCE(emp.full_name,'Unknown'), COALESCE(emp.employee_no,'-'),
      COALESCE(emp.department,'-'),
      to_char(r.supervisor_deadline - interval '72 hours','YYYY-MM-DD HH24:MI'),
      ROUND(GREATEST(remaining_h,0)::numeric, 1)
    );

    INSERT INTO public.notifications(user_id, type, title, body, link, related_appraisal_id)
    VALUES (
      COALESCE(r.escalated_to, r.chosen_supervisor_id),
      'appraisal_reminder_' || stage,
      'Reminder: appraisal review pending (' || stage || ')',
      msg,
      '/supervisor/review/' || r.id::text,
      r.id
    );

    INSERT INTO public.notification_log(
      channel, recipient, recipient_user_id, event_type, subject, body,
      related_appraisal_id, related_employee_id, status, provider, sent_at
    ) VALUES (
      'email', 'mock@local', COALESCE(r.escalated_to, r.chosen_supervisor_id),
      'appraisal_reminder_' || stage,
      'Reminder ' || stage || ': pending appraisal review',
      msg, r.id, r.employee_id, 'mocked', 'none', now()
    );

    IF stage = '24h' THEN
      UPDATE public.appraisals SET last_reminder_24h_at = now() WHERE id = r.id; cnt_24 := cnt_24 + 1;
    ELSIF stage = '48h' THEN
      UPDATE public.appraisals SET last_reminder_48h_at = now() WHERE id = r.id; cnt_48 := cnt_48 + 1;
    ELSIF stage = '60h' THEN
      UPDATE public.appraisals SET last_reminder_60h_at = now() WHERE id = r.id; cnt_60 := cnt_60 + 1;
    END IF;
  END LOOP;

  INSERT INTO public.audit_logs(action, entity_type, new_values)
  VALUES ('appraisal_reminders_run','system',
          jsonb_build_object('r24',cnt_24,'r48',cnt_48,'r60',cnt_60,'at',now()));

  RETURN jsonb_build_object('r24',cnt_24,'r48',cnt_48,'r60',cnt_60);
END $$;

GRANT EXECUTE ON FUNCTION public.process_appraisal_reminders() TO authenticated, service_role, anon;

-- 4. Role-scoped dashboard stats (used by popup + reports)
CREATE OR REPLACE FUNCTION public.dashboard_stats_for_role(_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_county boolean;
  is_co boolean;
  is_director boolean;
  is_sup boolean;
  my_dept text;
  my_dir text;
  result jsonb;
  total int; submitted int; approved int; pending int; returned int; escalated int;
  completion numeric;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid
                 AND role IN ('governor','cec','system_admin','super_admin','hr')) INTO is_county;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid AND role='chief_officer') INTO is_co;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid AND role='director')      INTO is_director;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid AND role='supervisor')    INTO is_sup;
  SELECT department, directorate INTO my_dept, my_dir FROM public.profiles WHERE id=_uid;

  IF is_county THEN
    SELECT count(*) FILTER (WHERE status='submitted'),
           count(*) FILTER (WHERE status='approved'),
           count(*) FILTER (WHERE status='rejected'),
           count(*) FILTER (WHERE status='submitted' AND escalated_at IS NOT NULL),
           count(*)
    INTO submitted, approved, returned, escalated, total FROM public.appraisals;
    completion := CASE WHEN total>0 THEN ROUND(approved::numeric/total*100,1) ELSE 0 END;

    result := jsonb_build_object(
      'scope','county', 'total',total,'submitted',submitted,'approved',approved,
      'returned',returned,'escalated',escalated,'completion_pct',completion,
      'top_departments', (
        SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM (
          SELECT p.department, count(*) FILTER (WHERE a.status='approved') AS approved, count(*) AS total
          FROM public.appraisals a JOIN public.profiles p ON p.id=a.employee_id
          WHERE p.department IS NOT NULL
          GROUP BY p.department ORDER BY approved DESC LIMIT 5
        ) t
      ),
      'overdue_departments', (
        SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM (
          SELECT p.department, count(*) AS overdue
          FROM public.appraisals a JOIN public.profiles p ON p.id=a.employee_id
          WHERE a.status='submitted' AND a.escalated_at IS NOT NULL
          GROUP BY p.department ORDER BY overdue DESC LIMIT 5
        ) t
      )
    );
  ELSIF is_co THEN
    SELECT count(*) FILTER (WHERE a.status='submitted'),
           count(*) FILTER (WHERE a.status='approved'),
           count(*) FILTER (WHERE a.status='rejected'),
           count(*) FILTER (WHERE a.status='submitted' AND a.escalated_at IS NOT NULL),
           count(*)
    INTO submitted, approved, returned, escalated, total
    FROM public.appraisals a JOIN public.profiles p ON p.id=a.employee_id
    WHERE lower(coalesce(p.department,'')) = lower(coalesce(my_dept,''));
    completion := CASE WHEN total>0 THEN ROUND(approved::numeric/total*100,1) ELSE 0 END;
    result := jsonb_build_object('scope','directorate','directorate',my_dept,
      'total',total,'submitted',submitted,'approved',approved,
      'returned',returned,'escalated',escalated,'completion_pct',completion);
  ELSIF is_director THEN
    SELECT count(*) FILTER (WHERE a.status='submitted'),
           count(*) FILTER (WHERE a.status='approved'),
           count(*) FILTER (WHERE a.status='rejected'),
           count(*) FILTER (WHERE a.status='submitted' AND a.escalated_at IS NOT NULL),
           count(*)
    INTO submitted, approved, returned, escalated, total
    FROM public.appraisals a JOIN public.profiles p ON p.id=a.employee_id
    WHERE lower(coalesce(p.department,''))=lower(coalesce(my_dept,''))
      AND lower(coalesce(p.directorate,''))=lower(coalesce(my_dir,''));
    completion := CASE WHEN total>0 THEN ROUND(approved::numeric/total*100,1) ELSE 0 END;
    result := jsonb_build_object('scope','department','department',my_dept,
      'total',total,'submitted',submitted,'approved',approved,
      'returned',returned,'escalated',escalated,'completion_pct',completion);
  ELSIF is_sup THEN
    SELECT count(*) FILTER (WHERE status='submitted'),
           count(*) FILTER (WHERE status='approved'),
           count(*) FILTER (WHERE status='rejected'),
           count(*) FILTER (WHERE status='submitted' AND escalated_at IS NOT NULL),
           count(*)
    INTO submitted, approved, returned, escalated, total
    FROM public.appraisals WHERE chosen_supervisor_id=_uid;
    pending := submitted;
    completion := CASE WHEN total>0 THEN ROUND(approved::numeric/total*100,1) ELSE 0 END;
    result := jsonb_build_object('scope','team',
      'total',total,'submitted',submitted,'pending',pending,'approved',approved,
      'returned',returned,'escalated',escalated,'completion_pct',completion);
  ELSE
    SELECT count(*) FILTER (WHERE status='submitted'),
           count(*) FILTER (WHERE status='approved'),
           count(*) FILTER (WHERE status IN ('draft','rejected')),
           count(*)
    INTO submitted, approved, pending, total
    FROM public.appraisals WHERE employee_id=_uid;
    -- county-wide completion for context
    DECLARE c_total int; c_done int;
    BEGIN
      SELECT count(*), count(*) FILTER (WHERE status='approved') INTO c_total, c_done FROM public.appraisals;
      completion := CASE WHEN c_total>0 THEN ROUND(c_done::numeric/c_total*100,1) ELSE 0 END;
    END;
    result := jsonb_build_object('scope','self',
      'total',total,'submitted',submitted,'approved',approved,'pending',pending,
      'county_completion_pct',completion);
  END IF;

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.dashboard_stats_for_role(uuid) TO authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- Migration: 20260622114612_9bd416ec-e000-485e-9647-cdc4639d6834.sql
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='appraisals') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.appraisals;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;
ALTER TABLE public.appraisals REPLICA IDENTITY FULL;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

-- ─────────────────────────────────────────────────────────────
-- Migration: 20260624065430_dec7bc20-c71a-436d-9e1b-6f6fe746d701.sql
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.department_progress_for_role(_uid uuid, _cycle_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  is_county boolean;
  is_co boolean;
  is_director boolean;
  is_sup boolean;
  my_dept text;
  my_dir text;
  my_section text;
  rows jsonb;
  totals jsonb;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid
                 AND role IN ('governor','cec','system_admin','super_admin','hr')) INTO is_county;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid AND role='chief_officer') INTO is_co;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid AND role='director')      INTO is_director;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid AND role='supervisor')    INTO is_sup;
  SELECT department, directorate, section INTO my_dept, my_dir, my_section FROM public.profiles WHERE id=_uid;

  WITH scope AS (
    SELECT p.id AS employee_id, p.department, p.directorate, p.section
    FROM public.profiles p
    WHERE p.employee_status='active'
      AND (
        is_county
        OR (is_co AND lower(coalesce(p.department,''))=lower(coalesce(my_dept,'')))
        OR (is_director AND lower(coalesce(p.department,''))=lower(coalesce(my_dept,''))
            AND lower(coalesce(p.directorate,''))=lower(coalesce(my_dir,'')))
        OR (is_sup AND lower(coalesce(p.section,''))=lower(coalesce(my_section,''))
            AND lower(coalesce(p.department,''))=lower(coalesce(my_dept,'')))
        OR (NOT (is_county OR is_co OR is_director OR is_sup))  -- self: county summary only
      )
  ),
  ap AS (
    SELECT a.* FROM public.appraisals a
    WHERE _cycle_id IS NULL OR a.cycle_id = _cycle_id
  ),
  per_dept AS (
    SELECT s.department,
           MAX(s.directorate) AS directorate,
           count(DISTINCT s.employee_id) AS employees,
           count(DISTINCT a.employee_id) FILTER (WHERE a.status IN ('submitted','approved','midyear','completed')) AS submitted,
           count(DISTINCT a.employee_id) FILTER (WHERE a.status='approved') AS approved,
           count(*) FILTER (WHERE a.status='submitted' AND a.escalated_at IS NOT NULL) AS escalated
    FROM scope s
    LEFT JOIN ap a ON a.employee_id=s.employee_id
    WHERE s.department IS NOT NULL AND s.department <> ''
    GROUP BY s.department
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'department', department,
           'directorate', directorate,
           'employees', employees,
           'submitted', submitted,
           'approved', approved,
           'pending', GREATEST(employees - submitted, 0),
           'escalated', escalated,
           'completion_pct', CASE WHEN employees>0 THEN ROUND(submitted::numeric/employees*100,1) ELSE 0 END
         ) ORDER BY (CASE WHEN employees>0 THEN submitted::numeric/employees ELSE 0 END) DESC), '[]'::jsonb)
  INTO rows FROM per_dept;

  SELECT jsonb_build_object(
    'employees', COALESCE(SUM((r->>'employees')::int),0),
    'submitted', COALESCE(SUM((r->>'submitted')::int),0),
    'approved',  COALESCE(SUM((r->>'approved')::int),0),
    'pending',   COALESCE(SUM((r->>'pending')::int),0),
    'escalated', COALESCE(SUM((r->>'escalated')::int),0)
  ) INTO totals
  FROM jsonb_array_elements(rows) r;

  RETURN jsonb_build_object(
    'scope', CASE WHEN is_county THEN 'county'
                  WHEN is_co THEN 'directorate'
                  WHEN is_director THEN 'department'
                  WHEN is_sup THEN 'section'
                  ELSE 'self' END,
    'rows', rows,
    'totals', totals,
    'completion_pct', CASE WHEN (totals->>'employees')::int > 0
                           THEN ROUND((totals->>'submitted')::numeric / (totals->>'employees')::numeric * 100, 1)
                           ELSE 0 END
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.department_progress_for_role(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.department_progress_history(_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  is_county boolean;
  is_co boolean;
  is_director boolean;
  my_dept text; my_dir text;
  result jsonb;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid
                 AND role IN ('governor','cec','system_admin','super_admin','hr')) INTO is_county;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid AND role='chief_officer') INTO is_co;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid AND role='director')      INTO is_director;
  SELECT department, directorate INTO my_dept, my_dir FROM public.profiles WHERE id=_uid;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'cycle_id', c.id,
    'cycle', c.name,
    'fy_start', c.fy_start,
    'submitted', x.submitted,
    'approved', x.approved,
    'total', x.total,
    'completion_pct', CASE WHEN x.total>0 THEN ROUND(x.submitted::numeric/x.total*100,1) ELSE 0 END
  ) ORDER BY c.fy_start), '[]'::jsonb)
  INTO result
  FROM public.appraisal_cycles c
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE a.status IN ('submitted','approved','midyear','completed')) AS submitted,
           count(*) FILTER (WHERE a.status='approved') AS approved,
           count(*) AS total
    FROM public.appraisals a
    JOIN public.profiles p ON p.id=a.employee_id
    WHERE a.cycle_id = c.id
      AND (
        is_county
        OR (is_co AND lower(coalesce(p.department,''))=lower(coalesce(my_dept,'')))
        OR (is_director AND lower(coalesce(p.department,''))=lower(coalesce(my_dept,''))
            AND lower(coalesce(p.directorate,''))=lower(coalesce(my_dir,'')))
      )
  ) x ON true;

  RETURN result;
END $function$;

GRANT EXECUTE ON FUNCTION public.department_progress_history(uuid) TO authenticated;


-- ─────────────────────────────────────────────────────────────
-- Migration: 20260624065639_f2979591-0fbb-444d-8389-ef26c7561c94.sql
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.department_progress_history(_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  is_county boolean;
  is_co boolean;
  is_director boolean;
  my_dept text; my_dir text;
  result jsonb;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid
                 AND role IN ('governor','cec','system_admin','super_admin','hr')) INTO is_county;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid AND role='chief_officer') INTO is_co;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid AND role='director')      INTO is_director;
  SELECT department, directorate INTO my_dept, my_dir FROM public.profiles WHERE id=_uid;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'cycle_id', c.id,
    'cycle', c.fy_label,
    'fy_start', c.fy_start,
    'submitted', x.submitted,
    'approved', x.approved,
    'total', x.total,
    'completion_pct', CASE WHEN x.total>0 THEN ROUND(x.submitted::numeric/x.total*100,1) ELSE 0 END
  ) ORDER BY c.fy_start), '[]'::jsonb)
  INTO result
  FROM public.appraisal_cycles c
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE a.status IN ('submitted','approved','midyear','completed')) AS submitted,
           count(*) FILTER (WHERE a.status='approved') AS approved,
           count(*) AS total
    FROM public.appraisals a
    JOIN public.profiles p ON p.id=a.employee_id
    WHERE a.cycle_id = c.id
      AND (
        is_county
        OR (is_co AND lower(coalesce(p.department,''))=lower(coalesce(my_dept,'')))
        OR (is_director AND lower(coalesce(p.department,''))=lower(coalesce(my_dept,''))
            AND lower(coalesce(p.directorate,''))=lower(coalesce(my_dir,'')))
      )
  ) x ON true;

  RETURN result;
END $function$;


-- ─────────────────────────────────────────────────────────────
-- Migration: 20260625162604_4c9f45e3-0119-47e8-bf0a-ad3755fc212a.sql
-- ─────────────────────────────────────────────────────────────

-- 1) Notification preferences on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS personal_email text,
  ADD COLUMN IF NOT EXISTS notify_email boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_sms boolean NOT NULL DEFAULT true;

-- 2) Extend otp_codes for password-reset purpose (reuses existing table)
ALTER TABLE public.otp_codes
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'login';

-- 3) Resolve any identifier (ID number OR personal number) to the synthetic login email.
CREATE OR REPLACE FUNCTION public.resolve_identifier(_identifier text)
RETURNS TABLE(user_id uuid, email text, phone_number text, personal_email text, full_name text, must_change_password boolean, employee_status employee_status)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, email, phone_number, personal_email, full_name, must_change_password, employee_status
  FROM public.profiles
  WHERE id_number = _identifier OR personal_number = _identifier
  LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION public.resolve_identifier(text) TO anon, authenticated;

-- 4) Default-password helper: standardised constant for imports
CREATE OR REPLACE FUNCTION public.default_employee_password()
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'BUNGOMA*039.'::text $$;
GRANT EXECUTE ON FUNCTION public.default_employee_password() TO authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- Migration: 20260626090509_9ff06221-d9b2-4ccc-9b0e-8b0e11e8f5e3.sql
-- ─────────────────────────────────────────────────────────────

-- Workplans (hierarchical assignment)
CREATE TABLE public.workplans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cycle_id uuid REFERENCES public.appraisal_cycles(id) ON DELETE SET NULL,
  period text NOT NULL,
  strategic_objective text NOT NULL,
  activity text NOT NULL,
  kpi text NOT NULL,
  target_value text NOT NULL,
  timeline text,
  weight numeric(5,2) DEFAULT 0,
  expected_deliverable text,
  status text NOT NULL DEFAULT 'assigned',
  pulled_into_appraisal_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workplans TO authenticated;
GRANT ALL ON public.workplans TO service_role;
ALTER TABLE public.workplans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wp_select_own_or_assigner_or_admin" ON public.workplans FOR SELECT TO authenticated
USING (
  assignee_id = auth.uid()
  OR assigned_by = auth.uid()
  OR public.is_admin_viewer(auth.uid())
  OR public.has_role(auth.uid(),'governor')
  OR public.has_role(auth.uid(),'cec')
  OR public.has_role(auth.uid(),'chief_officer')
  OR public.has_role(auth.uid(),'director')
  OR public.has_role(auth.uid(),'supervisor')
);
CREATE POLICY "wp_insert_by_assigner" ON public.workplans FOR INSERT TO authenticated
WITH CHECK (
  assigned_by = auth.uid()
  AND (
    public.has_role(auth.uid(),'supervisor')
    OR public.has_role(auth.uid(),'director')
    OR public.has_role(auth.uid(),'chief_officer')
    OR public.has_role(auth.uid(),'cec')
    OR public.has_role(auth.uid(),'governor')
    OR public.is_admin_viewer(auth.uid())
  )
);
CREATE POLICY "wp_update_assigner_or_admin" ON public.workplans FOR UPDATE TO authenticated
USING (assigned_by = auth.uid() OR public.is_admin_viewer(auth.uid()))
WITH CHECK (assigned_by = auth.uid() OR public.is_admin_viewer(auth.uid()));
CREATE POLICY "wp_delete_assigner_or_admin" ON public.workplans FOR DELETE TO authenticated
USING (assigned_by = auth.uid() OR public.is_admin_viewer(auth.uid()));

CREATE TRIGGER trg_workplans_touch BEFORE UPDATE ON public.workplans
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Continuous performance review updates
CREATE TABLE public.continuous_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  appraisal_id uuid REFERENCES public.appraisals(id) ON DELETE SET NULL,
  target_id uuid REFERENCES public.targets(id) ON DELETE SET NULL,
  workplan_id uuid REFERENCES public.workplans(id) ON DELETE SET NULL,
  achievement text NOT NULL,
  progress_status text NOT NULL DEFAULT 'in_progress',
  progress_comment text,
  challenges text,
  mitigation text,
  evidence_path text,
  evidence_filename text,
  evidence_mime text,
  supervisor_comment text,
  supervisor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  supervisor_commented_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.continuous_reviews TO authenticated;
GRANT ALL ON public.continuous_reviews TO service_role;
ALTER TABLE public.continuous_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cr_select_own_or_supervisor_or_admin" ON public.continuous_reviews FOR SELECT TO authenticated
USING (
  employee_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.appraisals a WHERE a.id = continuous_reviews.appraisal_id AND a.chosen_supervisor_id = auth.uid())
  OR public.is_admin_viewer(auth.uid())
  OR public.has_role(auth.uid(),'director')
  OR public.has_role(auth.uid(),'chief_officer')
);
CREATE POLICY "cr_insert_own" ON public.continuous_reviews FOR INSERT TO authenticated
WITH CHECK (employee_id = auth.uid());
CREATE POLICY "cr_update_own_or_supervisor" ON public.continuous_reviews FOR UPDATE TO authenticated
USING (
  employee_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.appraisals a WHERE a.id = continuous_reviews.appraisal_id AND a.chosen_supervisor_id = auth.uid())
  OR public.is_admin_viewer(auth.uid())
)
WITH CHECK (
  employee_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.appraisals a WHERE a.id = continuous_reviews.appraisal_id AND a.chosen_supervisor_id = auth.uid())
  OR public.is_admin_viewer(auth.uid())
);
CREATE POLICY "cr_delete_own" ON public.continuous_reviews FOR DELETE TO authenticated
USING (employee_id = auth.uid() OR public.is_admin_viewer(auth.uid()));

CREATE TRIGGER trg_continuous_reviews_touch BEFORE UPDATE ON public.continuous_reviews
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Storage policies for continuous-review-evidence bucket
CREATE POLICY "cre_select_own" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'continuous-review-evidence' AND (auth.uid()::text = (storage.foldername(name))[1] OR public.is_admin_viewer(auth.uid())));
CREATE POLICY "cre_insert_own" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'continuous-review-evidence' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "cre_update_own" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'continuous-review-evidence' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "cre_delete_own" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'continuous-review-evidence' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Self-appraisal structured reflections on appraisals
ALTER TABLE public.appraisals
  ADD COLUMN IF NOT EXISTS self_resources_needed text,
  ADD COLUMN IF NOT EXISTS self_challenges text,
  ADD COLUMN IF NOT EXISTS self_recommendations text,
  ADD COLUMN IF NOT EXISTS self_training_needs text,
  ADD COLUMN IF NOT EXISTS self_additional_comments text,
  ADD COLUMN IF NOT EXISTS supervisor_final_recommendation text;

-- Top performers RPC for director analytics
CREATE OR REPLACE FUNCTION public.top_performers_for_role(_uid uuid, _cycle_id uuid DEFAULT NULL, _limit int DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_county boolean; is_co boolean; is_director boolean;
  my_dept text; my_dir text;
  result jsonb;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid
    AND role IN ('governor','cec','system_admin','super_admin','hr')) INTO is_county;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid AND role='chief_officer') INTO is_co;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid AND role='director') INTO is_director;
  SELECT department, directorate INTO my_dept, my_dir FROM public.profiles WHERE id=_uid;

  WITH scored AS (
    SELECT
      a.employee_id, a.total_score, a.rating, a.status, a.period, a.cycle_id,
      p.full_name, p.employee_no, p.department, p.directorate, p.designation
    FROM public.appraisals a
    JOIN public.profiles p ON p.id = a.employee_id
    WHERE a.total_score IS NOT NULL
      AND (_cycle_id IS NULL OR a.cycle_id = _cycle_id)
      AND (
        is_county
        OR (is_co AND lower(coalesce(p.department,''))=lower(coalesce(my_dept,'')))
        OR (is_director AND lower(coalesce(p.department,''))=lower(coalesce(my_dept,''))
            AND lower(coalesce(p.directorate,''))=lower(coalesce(my_dir,'')))
      )
  ),
  ranked AS (
    SELECT *,
      RANK() OVER (PARTITION BY department ORDER BY total_score DESC) AS dept_rank,
      RANK() OVER (ORDER BY total_score DESC) AS county_rank
    FROM scored
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'employee_id', employee_id,
    'full_name', full_name,
    'employee_no', employee_no,
    'designation', designation,
    'department', department,
    'directorate', directorate,
    'period', period,
    'status', status,
    'score', total_score,
    'rating', rating,
    'department_rank', dept_rank,
    'county_rank', county_rank
  ) ORDER BY total_score DESC), '[]'::jsonb)
  INTO result
  FROM (SELECT * FROM ranked ORDER BY total_score DESC LIMIT _limit) t;

  RETURN COALESCE(result, '[]'::jsonb);
END $$;

GRANT EXECUTE ON FUNCTION public.top_performers_for_role(uuid, uuid, int) TO authenticated;


-- ─────────────────────────────────────────────────────────────
-- Migration: 20260628122331_67075453-6278-4d63-acdb-d1557881b3b7.sql
-- ─────────────────────────────────────────────────────────────

-- Notification channel preference
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notify_channel text NOT NULL DEFAULT 'both'
    CHECK (notify_channel IN ('email','sms','both','dashboard'));

-- Structured self-appraisal responses
ALTER TABLE public.appraisals
  ADD COLUMN IF NOT EXISTS self_resources_needed text,
  ADD COLUMN IF NOT EXISTS self_challenges       text,
  ADD COLUMN IF NOT EXISTS self_achievements     text,
  ADD COLUMN IF NOT EXISTS self_lessons          text,
  ADD COLUMN IF NOT EXISTS self_recommendations  text,
  ADD COLUMN IF NOT EXISTS self_training_needs   text,
  ADD COLUMN IF NOT EXISTS self_additional       text;

-- Prevent duplicate IDs / payroll numbers (allow nulls)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_id_number_unique
  ON public.profiles (id_number) WHERE id_number IS NOT NULL AND id_number <> '';
CREATE UNIQUE INDEX IF NOT EXISTS profiles_personal_number_unique
  ON public.profiles (personal_number) WHERE personal_number IS NOT NULL AND personal_number <> '';
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique
  ON public.profiles (lower(email)) WHERE email IS NOT NULL AND email <> '';

-- Department-scoped supervisor lookup for appraisee picker
CREATE OR REPLACE FUNCTION public.list_supervisors_for_dept(_dept text)
RETURNS TABLE(id uuid, full_name text, designation text, department text, directorate text, photo_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.full_name, p.designation, p.department, p.directorate, p.photo_url
  FROM public.profiles p
  JOIN public.user_roles r ON r.user_id = p.id
  WHERE r.role = 'supervisor'
    AND (_dept IS NULL OR _dept = '' OR lower(p.department) = lower(_dept))
    AND COALESCE(p.employee_status::text,'active') = 'active'
  ORDER BY p.full_name
$$;
GRANT EXECUTE ON FUNCTION public.list_supervisors_for_dept(text) TO authenticated;


-- ─────────────────────────────────────────────────────────────
-- Migration: 20260630111052_ad5a0b1e-a8ab-43c7-80f6-50ed1343302f.sql
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.workplans
  ADD COLUMN IF NOT EXISTS document_path text,
  ADD COLUMN IF NOT EXISTS document_name text,
  ADD COLUMN IF NOT EXISTS document_type text,
  ADD COLUMN IF NOT EXISTS document_size bigint,
  ADD COLUMN IF NOT EXISTS directorate text,
  ADD COLUMN IF NOT EXISTS department text;


-- ─────────────────────────────────────────────────────────────
-- Migration: 20260630111112_dba0d970-6ca5-418f-a3f6-9902e4b09f22.sql
-- ─────────────────────────────────────────────────────────────

CREATE POLICY "wp_docs_insert_auth" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'workplan-documents');
CREATE POLICY "wp_docs_select_auth" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'workplan-documents');
CREATE POLICY "wp_docs_update_owner" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'workplan-documents' AND owner = auth.uid());
CREATE POLICY "wp_docs_delete_owner" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'workplan-documents' AND owner = auth.uid());


-- ─────────────────────────────────────────────────────────────
-- Migration: 20260701063124_0d67dda9-a25b-4403-bcd8-fae0fc1ece28.sql
-- ─────────────────────────────────────────────────────────────
-- Phase 1: SPAS Foundations — Form 5 workplan structure, Additional Assignments, Report numbering

-- 1) Extend workplans for full CGB/SPA Form 5 shape
ALTER TABLE public.workplans
  ADD COLUMN IF NOT EXISTS resources_required text,
  ADD COLUMN IF NOT EXISTS workplan_type text NOT NULL DEFAULT 'annual' CHECK (workplan_type IN ('annual','quarterly')),
  ADD COLUMN IF NOT EXISTS quarter smallint CHECK (quarter BETWEEN 1 AND 4),
  ADD COLUMN IF NOT EXISTS reporting_period text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS parent_workplan_id uuid REFERENCES public.workplans(id) ON DELETE SET NULL;

-- 2) Workplan version history (snapshot of each edit)
CREATE TABLE IF NOT EXISTS public.workplan_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workplan_id uuid NOT NULL REFERENCES public.workplans(id) ON DELETE CASCADE,
  version int NOT NULL,
  snapshot jsonb NOT NULL,
  changed_by uuid REFERENCES auth.users(id),
  change_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.workplan_versions TO authenticated;
GRANT ALL ON public.workplan_versions TO service_role;
ALTER TABLE public.workplan_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wp_versions_view" ON public.workplan_versions FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.workplans w WHERE w.id = workplan_id AND (w.assignee_id=auth.uid() OR w.assigned_by=auth.uid() OR public.is_admin_viewer(auth.uid()))));
CREATE POLICY "wp_versions_insert" ON public.workplan_versions FOR INSERT TO authenticated
WITH CHECK (EXISTS(SELECT 1 FROM public.workplans w WHERE w.id = workplan_id AND w.assigned_by=auth.uid()));

-- 3) Additional Assignments (outside original workplan)
CREATE TABLE IF NOT EXISTS public.additional_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  supervisor_id uuid NOT NULL REFERENCES auth.users(id),
  appraisal_id uuid REFERENCES public.appraisals(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  date_assigned date NOT NULL DEFAULT current_date,
  due_date date,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','cancelled')),
  achievement_summary text,
  evidence_path text,
  completed_at timestamptz,
  quarter smallint CHECK (quarter BETWEEN 1 AND 4),
  period text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.additional_assignments TO authenticated;
GRANT ALL ON public.additional_assignments TO service_role;
ALTER TABLE public.additional_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aa_view" ON public.additional_assignments FOR SELECT TO authenticated
USING (employee_id=auth.uid() OR supervisor_id=auth.uid() OR public.is_admin_viewer(auth.uid())
       OR public.can_view_profile(auth.uid(), employee_id));
CREATE POLICY "aa_supervisor_manage" ON public.additional_assignments FOR ALL TO authenticated
USING (supervisor_id=auth.uid() OR public.is_admin_viewer(auth.uid()))
WITH CHECK (supervisor_id=auth.uid() OR public.is_admin_viewer(auth.uid()));
CREATE POLICY "aa_employee_update_own" ON public.additional_assignments FOR UPDATE TO authenticated
USING (employee_id=auth.uid()) WITH CHECK (employee_id=auth.uid());
CREATE TRIGGER aa_touch BEFORE UPDATE ON public.additional_assignments FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4) Report Registry with auto-numbering CGB/SPAS/YYYY/QN/NNNNNN
CREATE SEQUENCE IF NOT EXISTS public.report_number_seq;

CREATE TABLE IF NOT EXISTS public.report_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_number text NOT NULL UNIQUE,
  report_type text NOT NULL CHECK (report_type IN ('form2_quarterly','form3_departmental','form4_cipmc','form5_workplan','annual_summary','other')),
  cycle_id uuid REFERENCES public.appraisal_cycles(id),
  department text,
  directorate text,
  quarter smallint,
  fiscal_year text,
  related_appraisal_id uuid REFERENCES public.appraisals(id) ON DELETE SET NULL,
  related_workplan_id uuid REFERENCES public.workplans(id) ON DELETE SET NULL,
  related_employee_id uuid REFERENCES auth.users(id),
  pdf_path text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_by uuid REFERENCES auth.users(id),
  generated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.report_registry TO authenticated;
GRANT ALL ON public.report_registry TO service_role;
ALTER TABLE public.report_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reports_view" ON public.report_registry FOR SELECT TO authenticated
USING (public.is_admin_viewer(auth.uid())
       OR generated_by=auth.uid()
       OR related_employee_id=auth.uid()
       OR EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid()
                 AND role IN ('director','chief_officer','cec','governor','appeals_committee')));
CREATE POLICY "reports_insert" ON public.report_registry FOR INSERT TO authenticated
WITH CHECK (generated_by = auth.uid());

CREATE OR REPLACE FUNCTION public.next_report_number(_type text, _quarter smallint DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  yr text := to_char(now(),'YYYY');
  q text := CASE WHEN _quarter IS NULL THEN 'A' ELSE 'Q'||_quarter::text END;
  n bigint;
BEGIN
  n := nextval('public.report_number_seq');
  RETURN 'CGB/SPAS/' || yr || '/' || q || '/' || lpad(n::text, 6, '0');
END $$;

-- 5) Report sign-offs (typed digital signatures)
CREATE TABLE IF NOT EXISTS public.report_signoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.report_registry(id) ON DELETE CASCADE,
  signer_id uuid NOT NULL REFERENCES auth.users(id),
  signer_name text NOT NULL,
  signer_position text NOT NULL,
  stage text NOT NULL CHECK (stage IN ('employee','supervisor','director','chief_officer','cipmc','cec','governor')),
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','rejected','pending')),
  remarks text,
  signed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.report_signoffs TO authenticated;
GRANT ALL ON public.report_signoffs TO service_role;
ALTER TABLE public.report_signoffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "signoffs_view" ON public.report_signoffs FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.report_registry r WHERE r.id = report_id
              AND (r.generated_by=auth.uid() OR r.related_employee_id=auth.uid() OR public.is_admin_viewer(auth.uid())
                   OR EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid()
                             AND role IN ('director','chief_officer','cec','governor','appeals_committee')))));
CREATE POLICY "signoffs_insert" ON public.report_signoffs FOR INSERT TO authenticated
WITH CHECK (signer_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_report_registry_type ON public.report_registry(report_type, fiscal_year, quarter);
CREATE INDEX IF NOT EXISTS idx_report_registry_dept ON public.report_registry(department);
CREATE INDEX IF NOT EXISTS idx_aa_employee ON public.additional_assignments(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_aa_supervisor ON public.additional_assignments(supervisor_id);

-- ─────────────────────────────────────────────────────────────
-- Migration: 20260701135517_3984f618-800b-4a00-b367-b657f7789ffa.sql
-- ─────────────────────────────────────────────────────────────
-- Phase 1: Performance Contract foundations

-- Enums
DO $$ BEGIN
  CREATE TYPE public.contract_level AS ENUM ('governor','cec','chief_officer','director','supervisor','appraisee');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.contract_status AS ENUM (
    'draft','negotiation','returned_for_amendment','resubmitted',
    'submitted','under_review','approved','signed','locked','reopened','archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.matrix_category AS ENUM (
    'financial_stewardship','service_delivery','institutional_transformation','core_mandate','cross_cutting'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Performance Contracts
CREATE TABLE IF NOT EXISTS public.performance_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  level public.contract_level NOT NULL,
  parent_contract_id UUID REFERENCES public.performance_contracts(id) ON DELETE SET NULL,
  supervisor_id UUID REFERENCES auth.users(id),
  cycle_id UUID REFERENCES public.appraisal_cycles(id),
  fy_label TEXT,
  fy_start DATE,
  fy_end DATE,
  directorate TEXT,
  department TEXT,
  title TEXT NOT NULL DEFAULT 'Performance Contract',
  -- Official sections
  statement_of_responsibility TEXT,
  vision_statement TEXT,
  mission_statement TEXT,
  strategic_objectives TEXT,
  statement_of_strategic_intent TEXT,
  commitments_and_obligations TEXT,
  reporting_requirements TEXT,
  contract_duration_start DATE,
  contract_duration_end DATE,
  status public.contract_status NOT NULL DEFAULT 'draft',
  submitted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES auth.users(id),
  signed_at TIMESTAMPTZ,
  locked_at TIMESTAMPTZ,
  reopened_at TIMESTAMPTZ,
  reopened_by UUID REFERENCES auth.users(id),
  reopen_reason TEXT,
  return_reason TEXT,
  version INT NOT NULL DEFAULT 1,
  contract_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.performance_contracts TO authenticated;
GRANT ALL ON public.performance_contracts TO service_role;
ALTER TABLE public.performance_contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner reads own contract" ON public.performance_contracts
  FOR SELECT TO authenticated USING (
    owner_id = auth.uid()
    OR supervisor_id = auth.uid()
    OR public.has_role(auth.uid(),'system_admin')
    OR public.has_role(auth.uid(),'super_admin')
    OR public.has_role(auth.uid(),'hr')
    OR public.has_role(auth.uid(),'governor')
    OR public.can_view_profile(auth.uid(), owner_id)
  );

CREATE POLICY "owner writes own draft" ON public.performance_contracts
  FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());

CREATE POLICY "owner or supervisor updates" ON public.performance_contracts
  FOR UPDATE TO authenticated USING (
    (owner_id = auth.uid() AND status IN ('draft','returned_for_amendment','resubmitted','reopened'))
    OR supervisor_id = auth.uid()
    OR public.has_role(auth.uid(),'system_admin')
    OR public.has_role(auth.uid(),'super_admin')
  );

CREATE POLICY "admin delete" ON public.performance_contracts
  FOR DELETE TO authenticated USING (
    public.has_role(auth.uid(),'system_admin') OR public.has_role(auth.uid(),'super_admin')
  );

CREATE INDEX IF NOT EXISTS idx_pc_owner ON public.performance_contracts(owner_id);
CREATE INDEX IF NOT EXISTS idx_pc_parent ON public.performance_contracts(parent_contract_id);
CREATE INDEX IF NOT EXISTS idx_pc_status ON public.performance_contracts(status);

CREATE TRIGGER pc_touch BEFORE UPDATE ON public.performance_contracts
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Objectives / Matrix rows
CREATE TABLE IF NOT EXISTS public.contract_objectives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.performance_contracts(id) ON DELETE CASCADE,
  category public.matrix_category NOT NULL,
  objective TEXT NOT NULL,
  indicator TEXT,
  target TEXT,
  weight NUMERIC(5,2) NOT NULL DEFAULT 0,
  baseline TEXT,
  data_source TEXT,
  achievement TEXT,
  raw_score NUMERIC(6,2),
  weighted_score NUMERIC(6,2),
  achievement_pct NUMERIC(6,2),
  sort_order INT DEFAULT 0,
  cascaded_from_id UUID REFERENCES public.contract_objectives(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contract_objectives TO authenticated;
GRANT ALL ON public.contract_objectives TO service_role;
ALTER TABLE public.contract_objectives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "objectives follow contract read" ON public.contract_objectives
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.performance_contracts c WHERE c.id = contract_id
            AND (c.owner_id = auth.uid() OR c.supervisor_id = auth.uid()
                 OR public.has_role(auth.uid(),'system_admin')
                 OR public.has_role(auth.uid(),'super_admin')
                 OR public.has_role(auth.uid(),'hr')
                 OR public.has_role(auth.uid(),'governor')
                 OR public.can_view_profile(auth.uid(), c.owner_id)))
  );

CREATE POLICY "objectives follow contract write" ON public.contract_objectives
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.performance_contracts c WHERE c.id = contract_id
            AND ((c.owner_id = auth.uid() AND c.status IN ('draft','returned_for_amendment','resubmitted','reopened'))
                 OR c.supervisor_id = auth.uid()
                 OR public.has_role(auth.uid(),'system_admin')
                 OR public.has_role(auth.uid(),'super_admin')))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.performance_contracts c WHERE c.id = contract_id
            AND ((c.owner_id = auth.uid() AND c.status IN ('draft','returned_for_amendment','resubmitted','reopened'))
                 OR c.supervisor_id = auth.uid()
                 OR public.has_role(auth.uid(),'system_admin')
                 OR public.has_role(auth.uid(),'super_admin')))
  );

CREATE TRIGGER co_touch BEFORE UPDATE ON public.contract_objectives
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Sign-offs (typed digital signature)
CREATE TABLE IF NOT EXISTS public.contract_signoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.performance_contracts(id) ON DELETE CASCADE,
  signer_id UUID NOT NULL REFERENCES auth.users(id),
  signer_role public.contract_level NOT NULL,
  signer_name TEXT NOT NULL,
  signer_position TEXT,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  comment TEXT,
  ip_address TEXT
);

GRANT SELECT, INSERT ON public.contract_signoffs TO authenticated;
GRANT ALL ON public.contract_signoffs TO service_role;
ALTER TABLE public.contract_signoffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "signoffs read w/ contract" ON public.contract_signoffs
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.performance_contracts c WHERE c.id = contract_id
            AND (c.owner_id = auth.uid() OR c.supervisor_id = auth.uid()
                 OR public.has_role(auth.uid(),'system_admin')
                 OR public.has_role(auth.uid(),'super_admin')
                 OR public.has_role(auth.uid(),'hr')
                 OR public.can_view_profile(auth.uid(), c.owner_id)))
  );
CREATE POLICY "signer inserts own signoff" ON public.contract_signoffs
  FOR INSERT TO authenticated WITH CHECK (signer_id = auth.uid());

-- Contract audit trail (append-only, historical)
CREATE TABLE IF NOT EXISTS public.contract_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.performance_contracts(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES auth.users(id),
  event_type TEXT NOT NULL,
  from_status public.contract_status,
  to_status public.contract_status,
  comment TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.contract_events TO authenticated;
GRANT ALL ON public.contract_events TO service_role;
ALTER TABLE public.contract_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "events read w/ contract" ON public.contract_events
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.performance_contracts c WHERE c.id = contract_id
            AND (c.owner_id = auth.uid() OR c.supervisor_id = auth.uid()
                 OR public.has_role(auth.uid(),'system_admin')
                 OR public.has_role(auth.uid(),'super_admin')
                 OR public.has_role(auth.uid(),'hr')
                 OR public.can_view_profile(auth.uid(), c.owner_id)))
  );
CREATE POLICY "actor inserts event" ON public.contract_events
  FOR INSERT TO authenticated WITH CHECK (actor_id = auth.uid() OR actor_id IS NULL);

-- RPC: can a subordinate start their contract? (parent must be signed/locked)
CREATE OR REPLACE FUNCTION public.can_start_contract(_owner UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE sup UUID; parent_status public.contract_status;
BEGIN
  SELECT supervisor_id INTO sup FROM public.profiles WHERE id = _owner;
  IF sup IS NULL THEN RETURN true; END IF; -- top of chain (Governor)
  SELECT status INTO parent_status FROM public.performance_contracts
    WHERE owner_id = sup ORDER BY created_at DESC LIMIT 1;
  RETURN parent_status IN ('signed','locked');
END $$;

-- RPC: reopen contract (originating approver + one level up + admin)
CREATE OR REPLACE FUNCTION public.reopen_contract(_contract UUID, _reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.performance_contracts%ROWTYPE; grand UUID; allowed BOOLEAN := false;
BEGIN
  SELECT * INTO c FROM public.performance_contracts WHERE id = _contract;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Contract not found'; END IF;
  IF public.has_role(auth.uid(),'system_admin') OR public.has_role(auth.uid(),'super_admin') THEN
    allowed := true;
  ELSIF c.approved_by = auth.uid() OR c.supervisor_id = auth.uid() THEN
    allowed := true;
  ELSE
    -- one level up: supervisor of the approver
    SELECT supervisor_id INTO grand FROM public.profiles WHERE id = c.approved_by;
    IF grand = auth.uid() THEN allowed := true; END IF;
  END IF;
  IF NOT allowed THEN RAISE EXCEPTION 'Not authorised to reopen this contract'; END IF;

  UPDATE public.performance_contracts
    SET status='reopened', reopened_at=now(), reopened_by=auth.uid(),
        reopen_reason=_reason, locked_at=NULL, version=version+1
    WHERE id=_contract;

  INSERT INTO public.contract_events(contract_id, actor_id, event_type, from_status, to_status, comment)
  VALUES (_contract, auth.uid(), 'reopened', c.status, 'reopened', _reason);
END $$;

-- Trigger: auto-log status changes to contract_events + auto-issue contract_number on signing
CREATE OR REPLACE FUNCTION public.on_contract_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.contract_events(contract_id, actor_id, event_type, from_status, to_status)
    VALUES (NEW.id, auth.uid(), 'status_change', OLD.status, NEW.status);

    IF NEW.status='signed' AND OLD.status<>'signed' AND NEW.contract_number IS NULL THEN
      NEW.contract_number := 'CGB/PC/' || to_char(now(),'YYYY') || '/' ||
                             lpad(nextval('public.report_number_seq')::text,6,'0');
      NEW.signed_at := now();
    END IF;
    IF NEW.status='locked' AND OLD.status<>'locked' THEN
      NEW.locked_at := now();
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pc_change ON public.performance_contracts;
CREATE TRIGGER trg_pc_change BEFORE UPDATE ON public.performance_contracts
FOR EACH ROW EXECUTE FUNCTION public.on_contract_change();

-- Matrix reference (structure + total weights) - readable to all authenticated
CREATE TABLE IF NOT EXISTS public.matrix_reference (
  category public.matrix_category PRIMARY KEY,
  label TEXT NOT NULL,
  total_weight NUMERIC(5,2) NOT NULL,
  display_order INT NOT NULL
);
GRANT SELECT ON public.matrix_reference TO authenticated, anon;
GRANT ALL ON public.matrix_reference TO service_role;
ALTER TABLE public.matrix_reference ENABLE ROW LEVEL SECURITY;
CREATE POLICY "matrix ref readable" ON public.matrix_reference FOR SELECT TO authenticated, anon USING (true);

INSERT INTO public.matrix_reference(category,label,total_weight,display_order) VALUES
  ('financial_stewardship','Financial Stewardship & Discipline',10,1),
  ('service_delivery','Service Delivery',8,2),
  ('institutional_transformation','Institutional Transformation',10,3),
  ('core_mandate','Core Mandate',60,4),
  ('cross_cutting','Cross-Cutting Issues',12,5)
ON CONFLICT (category) DO UPDATE
  SET label=EXCLUDED.label, total_weight=EXCLUDED.total_weight, display_order=EXCLUDED.display_order;


-- ─────────────────────────────────────────────────────────────
-- Migration: 20260702110204_75d2b7fd-e6d9-43a2-9d2d-c13cefe84a21.sql
-- ─────────────────────────────────────────────────────────────

-- Phase 2: Gate appraisals on signed performance contract + timeline helpers

CREATE OR REPLACE FUNCTION public.has_signed_contract(_owner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.performance_contracts
    WHERE owner_id = _owner AND status IN ('signed','locked')
  )
$$;

CREATE OR REPLACE FUNCTION public.enforce_contract_before_appraisal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_contract_before_appraisal ON public.appraisals;
CREATE TRIGGER trg_enforce_contract_before_appraisal
  BEFORE INSERT ON public.appraisals
  FOR EACH ROW EXECUTE FUNCTION public.enforce_contract_before_appraisal();

-- Calendar/timeline: derive stages from cycle fy_start
CREATE OR REPLACE FUNCTION public.appraisal_calendar(_uid uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  fy_start date;
  fy_end date;
  fy_label text;
  contract_status text;
  appraisal_status text;
  current_stage text;
  stages jsonb;
BEGIN
  SELECT c.fy_start, c.fy_end, c.fy_label
    INTO fy_start, fy_end, fy_label
    FROM public.appraisal_cycles c
    ORDER BY c.fy_start DESC NULLS LAST LIMIT 1;

  SELECT status::text INTO contract_status
    FROM public.performance_contracts
    WHERE owner_id = _uid ORDER BY created_at DESC LIMIT 1;

  SELECT status::text INTO appraisal_status
    FROM public.appraisals
    WHERE employee_id = _uid ORDER BY created_at DESC LIMIT 1;

  -- Determine current stage
  IF contract_status IS NULL OR contract_status NOT IN ('signed','locked') THEN
    current_stage := 'contract';
  ELSIF appraisal_status IS NULL OR appraisal_status IN ('draft','rejected') THEN
    current_stage := 'target_setting';
  ELSIF appraisal_status = 'submitted' THEN
    current_stage := 'supervisor_review';
  ELSIF fy_start IS NULL THEN
    current_stage := 'approved';
  ELSIF now() < fy_start + interval '3 months' THEN current_stage := 'q1';
  ELSIF now() < fy_start + interval '6 months' THEN current_stage := 'q2_midyear';
  ELSIF now() < fy_start + interval '9 months' THEN current_stage := 'q3';
  ELSIF now() < fy_start + interval '12 months' THEN current_stage := 'q4_endyear';
  ELSE current_stage := 'closed';
  END IF;

  stages := jsonb_build_array(
    jsonb_build_object('key','contract','label','Performance Contract','date', to_char(COALESCE(fy_start - interval '30 days', now()),'YYYY-MM-DD')),
    jsonb_build_object('key','target_setting','label','Target Setting','date', to_char(COALESCE(fy_start, now()),'YYYY-MM-DD')),
    jsonb_build_object('key','supervisor_review','label','Supervisor Review & Approval','date', to_char(COALESCE(fy_start + interval '14 days', now()),'YYYY-MM-DD')),
    jsonb_build_object('key','q1','label','Q1 Review','date', to_char(COALESCE(fy_start + interval '3 months', now()),'YYYY-MM-DD')),
    jsonb_build_object('key','q2_midyear','label','Mid-Year Review (Q2)','date', to_char(COALESCE(fy_start + interval '6 months', now()),'YYYY-MM-DD')),
    jsonb_build_object('key','q3','label','Q3 Review','date', to_char(COALESCE(fy_start + interval '9 months', now()),'YYYY-MM-DD')),
    jsonb_build_object('key','q4_endyear','label','End-Year Appraisal (Q4)','date', to_char(COALESCE(fy_start + interval '12 months', now()),'YYYY-MM-DD')),
    jsonb_build_object('key','closed','label','Cycle Closed / Appeals','date', to_char(COALESCE(fy_end, fy_start + interval '13 months', now()),'YYYY-MM-DD'))
  );

  RETURN jsonb_build_object(
    'fy_label', fy_label,
    'fy_start', fy_start,
    'fy_end', fy_end,
    'contract_status', contract_status,
    'appraisal_status', appraisal_status,
    'current_stage', current_stage,
    'stages', stages
  );
END $$;

GRANT EXECUTE ON FUNCTION public.has_signed_contract(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.appraisal_calendar(uuid) TO authenticated;


-- ─────────────────────────────────────────────────────────────
-- Migration: 20260702120114_d7219e7b-8a42-4a0c-8e5e-6651090276cd.sql
-- ─────────────────────────────────────────────────────────────

-- 1. Update can_start_contract: only allow contract-eligible roles
CREATE OR REPLACE FUNCTION public.can_start_contract(_owner uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE has_eligible boolean; sup UUID; parent_status public.contract_status;
BEGIN
  -- Only Governor, CEC, Chief Officer, Director, Supervisor prepare contracts.
  SELECT EXISTS(
    SELECT 1 FROM public.user_roles
    WHERE user_id = _owner
      AND role IN ('governor','cec','chief_officer','director','supervisor')
  ) INTO has_eligible;
  IF NOT has_eligible THEN RETURN false; END IF;

  SELECT supervisor_id INTO sup FROM public.profiles WHERE id = _owner;
  IF sup IS NULL THEN RETURN true; END IF;
  SELECT status INTO parent_status FROM public.performance_contracts
    WHERE owner_id = sup ORDER BY created_at DESC LIMIT 1;
  RETURN parent_status IN ('signed','locked');
END $function$;

-- 2. Employees do not need a personal contract; they only need an assigned workplan
CREATE OR REPLACE FUNCTION public.enforce_contract_before_appraisal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN NEW;
END $function$;

-- 3. Sign-off status for an employee's department (Governor -> CEC -> CO -> Director/Supervisor)
CREATE OR REPLACE FUNCTION public.department_signoff_status(_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  my_dept text; my_dir text; my_sup uuid;
  stages jsonb := '[]'::jsonb;
  gov_signed timestamptz; gov_name text;
  cec_signed timestamptz; cec_name text; cec_uid uuid;
  co_signed timestamptz;  co_name  text; co_uid uuid;
  dir_signed timestamptz; dir_name text; dir_uid uuid;
  wp_signed timestamptz;
BEGIN
  SELECT department, directorate, supervisor_id INTO my_dept, my_dir, my_sup
    FROM public.profiles WHERE id = _uid;

  -- Governor sign-off on CEC of same department
  SELECT pc.signed_at, p.full_name INTO gov_signed, gov_name
  FROM public.performance_contracts pc
  JOIN public.user_roles ur ON ur.user_id = pc.owner_id AND ur.role = 'cec'
  JOIN public.profiles p ON p.id = pc.approved_by
  WHERE pc.status IN ('signed','locked')
    AND lower(coalesce(pc.department,'')) = lower(coalesce(my_dept,''))
  ORDER BY pc.signed_at DESC NULLS LAST LIMIT 1;

  -- CEC sign-off on Chief Officer of same department
  SELECT pc.signed_at, p.full_name, pc.owner_id INTO cec_signed, cec_name, cec_uid
  FROM public.performance_contracts pc
  JOIN public.user_roles ur ON ur.user_id = pc.owner_id AND ur.role = 'chief_officer'
  JOIN public.profiles p ON p.id = pc.approved_by
  WHERE pc.status IN ('signed','locked')
    AND lower(coalesce(pc.department,'')) = lower(coalesce(my_dept,''))
  ORDER BY pc.signed_at DESC NULLS LAST LIMIT 1;

  -- Chief Officer sign-off on Director of same directorate/department
  SELECT pc.signed_at, p.full_name, pc.owner_id INTO co_signed, co_name, co_uid
  FROM public.performance_contracts pc
  JOIN public.user_roles ur ON ur.user_id = pc.owner_id AND ur.role = 'director'
  JOIN public.profiles p ON p.id = pc.approved_by
  WHERE pc.status IN ('signed','locked')
    AND lower(coalesce(pc.department,'')) = lower(coalesce(my_dept,''))
    AND (my_dir IS NULL OR lower(coalesce(pc.directorate,'')) = lower(coalesce(my_dir,'')))
  ORDER BY pc.signed_at DESC NULLS LAST LIMIT 1;

  -- Workplan assigned to this employee
  SELECT MAX(w.approved_at), MAX(p.full_name) INTO wp_signed, dir_name
  FROM public.workplans w
  LEFT JOIN public.profiles p ON p.id = w.approved_by
  WHERE w.assignee_id = _uid AND w.status IN ('approved','active','completed');

  stages := jsonb_build_array(
    jsonb_build_object(
      'key','governor','label','Governor approves CEC contract',
      'signed_at', gov_signed, 'signer', gov_name,
      'status', CASE WHEN gov_signed IS NOT NULL THEN 'complete' ELSE 'pending' END,
      'message', CASE WHEN gov_signed IS NOT NULL
        THEN '✓ Governor has approved the ' || coalesce(my_dept,'department') || ' Performance Contract'
        ELSE 'Awaiting Governor approval of the ' || coalesce(my_dept,'department') || ' CEC contract' END
    ),
    jsonb_build_object(
      'key','cec','label','CEC approves Chief Officer contract',
      'signed_at', cec_signed, 'signer', cec_name,
      'status', CASE WHEN cec_signed IS NOT NULL THEN 'complete' ELSE 'pending' END,
      'message', CASE WHEN cec_signed IS NOT NULL
        THEN '✓ ' || coalesce(my_dept,'') || ' CEC has approved the Chief Officer Performance Contract'
        ELSE 'Awaiting CEC approval of the Chief Officer contract' END
    ),
    jsonb_build_object(
      'key','chief_officer','label','Chief Officer approves Director contract',
      'signed_at', co_signed, 'signer', co_name,
      'status', CASE WHEN co_signed IS NOT NULL THEN 'complete' ELSE 'pending' END,
      'message', CASE WHEN co_signed IS NOT NULL
        THEN '✓ Chief Officer has approved the Director''s Performance Contract'
        ELSE 'Awaiting Chief Officer approval of the Director contract' END
    ),
    jsonb_build_object(
      'key','workplan','label','Director/Supervisor assigns workplan',
      'signed_at', wp_signed, 'signer', dir_name,
      'status', CASE WHEN wp_signed IS NOT NULL THEN 'complete' ELSE 'pending' END,
      'message', CASE WHEN wp_signed IS NOT NULL
        THEN '✓ Your Workplan has been approved by your Director/Supervisor'
        ELSE 'Awaiting workplan assignment from your Director/Supervisor' END
    )
  );

  RETURN jsonb_build_object(
    'department', my_dept,
    'directorate', my_dir,
    'stages', stages,
    'ready_for_appraisal', (wp_signed IS NOT NULL)
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.department_signoff_status(uuid) TO authenticated;


-- ─────────────────────────────────────────────────────────────
-- Migration: 20260708071908_d67fef18-e565-45cf-abdc-42894124e957.sql
-- ─────────────────────────────────────────────────────────────

-- Trigger: auto-log key appraisal transitions into audit_logs
CREATE OR REPLACE FUNCTION public.audit_appraisal_changes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, new_values)
    VALUES (COALESCE(auth.uid(), NEW.employee_id), 'appraisal_created', 'appraisals', NEW.id::text,
      jsonb_build_object('period', NEW.period, 'status', NEW.status));
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, old_values, new_values)
    VALUES (auth.uid(), 'appraisal_status_changed', 'appraisals', NEW.id::text,
      jsonb_build_object('status', OLD.status),
      jsonb_build_object('status', NEW.status, 'reason', NEW.rejection_reason));
  END IF;

  IF NEW.employee_signed_at IS DISTINCT FROM OLD.employee_signed_at
     AND NEW.employee_signed_at IS NOT NULL THEN
    INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, new_values)
    VALUES (auth.uid(), 'employee_signed', 'appraisals', NEW.id::text,
      jsonb_build_object('at', NEW.employee_signed_at));
  END IF;

  IF NEW.supervisor_reviewed_at IS DISTINCT FROM OLD.supervisor_reviewed_at
     AND NEW.supervisor_reviewed_at IS NOT NULL THEN
    INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, new_values)
    VALUES (auth.uid(), 'supervisor_reviewed', 'appraisals', NEW.id::text,
      jsonb_build_object('at', NEW.supervisor_reviewed_at, 'status', NEW.status));
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_audit_appraisals ON public.appraisals;
CREATE TRIGGER trg_audit_appraisals
  AFTER INSERT OR UPDATE ON public.appraisals
  FOR EACH ROW EXECUTE FUNCTION public.audit_appraisal_changes();

-- RPC: authorised timeline for a single appraisal
CREATE OR REPLACE FUNCTION public.appraisal_timeline(_appraisal_id uuid)
RETURNS TABLE(
  id uuid,
  at timestamptz,
  actor_id uuid,
  actor_name text,
  actor_email text,
  action text,
  details jsonb
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _emp uuid;
  _sup uuid;
  _allowed boolean;
BEGIN
  SELECT a.employee_id, a.chosen_supervisor_id INTO _emp, _sup
  FROM public.appraisals a WHERE a.id = _appraisal_id;

  IF _emp IS NULL THEN
    RAISE EXCEPTION 'Appraisal not found';
  END IF;

  _allowed :=
    auth.uid() = _emp
    OR auth.uid() = _sup
    OR public.is_admin_viewer(auth.uid())
    OR public.can_sign_as_supervisor(auth.uid(), _emp);

  IF NOT _allowed THEN
    RAISE EXCEPTION 'Not authorised to view this timeline';
  END IF;

  RETURN QUERY
    SELECT
      l.id,
      l.created_at AS at,
      l.actor_id,
      COALESCE(p.full_name, l.actor_email) AS actor_name,
      l.actor_email,
      l.action,
      COALESCE(l.new_values, l.old_values) AS details
    FROM public.audit_logs l
    LEFT JOIN public.profiles p ON p.id = l.actor_id
    WHERE l.entity_type = 'appraisals'
      AND l.entity_id = _appraisal_id::text
    ORDER BY l.created_at ASC;
END $$;

GRANT EXECUTE ON FUNCTION public.appraisal_timeline(uuid) TO authenticated;


-- ─────────────────────────────────────────────────────────────
-- Migration: 20260709064902_323f7e08-03d4-4b82-83e6-e4f986440226.sql
-- ─────────────────────────────────────────────────────────────
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'dept_admin';

-- ─────────────────────────────────────────────────────────────
-- Migration: 20260709065009_f7e3c24a-3079-4dca-a67e-50407c65cab6.sql
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.performance_matrix (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  department text NOT NULL,
  category text NOT NULL CHECK (category IN (
    'financial_stewardship','service_delivery','institutional_transformation','core_mandate','cross_cutting'
  )),
  target text NOT NULL,
  unit text NOT NULL DEFAULT 'Number',
  weight numeric NOT NULL DEFAULT 0 CHECK (weight >= 0 AND weight <= 100),
  type text NOT NULL DEFAULT 'Quantitative' CHECK (type IN (
    'Quantitative','Qualitative','Continuous','Compliance','Strategic','Financial'
  )),
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.performance_matrix TO authenticated;
GRANT ALL ON public.performance_matrix TO service_role;

ALTER TABLE public.performance_matrix ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pm read all" ON public.performance_matrix;
CREATE POLICY "pm read all" ON public.performance_matrix FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "pm manage" ON public.performance_matrix;
CREATE POLICY "pm manage" ON public.performance_matrix
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'system_admin') OR public.has_role(auth.uid(),'super_admin')
    OR public.has_role_in_dept(auth.uid(),'dept_admin', department)
  )
  WITH CHECK (
    public.has_role(auth.uid(),'system_admin') OR public.has_role(auth.uid(),'super_admin')
    OR public.has_role_in_dept(auth.uid(),'dept_admin', department)
  );

DROP TRIGGER IF EXISTS trg_pm_touch ON public.performance_matrix;
CREATE TRIGGER trg_pm_touch BEFORE UPDATE ON public.performance_matrix
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_pm_dept_cat ON public.performance_matrix(department, category, sort_order);

ALTER TABLE public.contract_objectives ADD COLUMN IF NOT EXISTS unit text;
ALTER TABLE public.contract_objectives ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE public.contract_objectives ADD COLUMN IF NOT EXISTS matrix_id uuid REFERENCES public.performance_matrix(id) ON DELETE SET NULL;

-- Seed official matrix template into every existing department
DO $$
DECLARE d text;
BEGIN
  FOR d IN SELECT DISTINCT department FROM public.profiles WHERE department IS NOT NULL AND department <> ''
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.performance_matrix WHERE department = d) THEN
      INSERT INTO public.performance_matrix (department, category, target, unit, weight, type, sort_order) VALUES
        (d,'financial_stewardship','Absorption of development budget','%',8,'Financial',1),
        (d,'financial_stewardship','Absorption of recurrent budget','%',5,'Financial',2),
        (d,'financial_stewardship','Pending bills as % of budget','%',4,'Financial',3),
        (d,'financial_stewardship','Audit queries resolved','Number',3,'Compliance',4),
        (d,'service_delivery','Citizen service charter compliance','%',8,'Compliance',1),
        (d,'service_delivery','Service delivery targets achieved','%',10,'Quantitative',2),
        (d,'service_delivery','Customer satisfaction index','%',7,'Qualitative',3),
        (d,'institutional_transformation','ISO / QMS certification maintained','Compliance',5,'Compliance',1),
        (d,'institutional_transformation','Automation of key services','Number',5,'Strategic',2),
        (d,'institutional_transformation','Staff training days delivered','Days',5,'Quantitative',3),
        (d,'core_mandate','Departmental strategic outputs delivered','Number',20,'Strategic',1),
        (d,'core_mandate','Statutory reports submitted on time','Report',10,'Compliance',2),
        (d,'cross_cutting','Gender mainstreaming targets','%',3,'Compliance',1),
        (d,'cross_cutting','PWD inclusion targets','%',3,'Compliance',2),
        (d,'cross_cutting','Environmental sustainability actions','Number',2,'Compliance',3),
        (d,'cross_cutting','Anti-corruption & integrity actions','Number',2,'Compliance',4);
    END IF;
  END LOOP;
END $$;

-- Strict hierarchical eligibility
CREATE OR REPLACE FUNCTION public.can_start_contract(_owner uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  my_dept text; my_dir text;
  is_gov boolean; is_cec boolean; is_co boolean; is_dir boolean; is_sup boolean;
  parent_status public.contract_status;
BEGIN
  SELECT department, directorate INTO my_dept, my_dir FROM public.profiles WHERE id = _owner;
  is_gov := public.has_role(_owner,'governor');
  is_cec := public.has_role(_owner,'cec');
  is_co  := public.has_role(_owner,'chief_officer');
  is_dir := public.has_role(_owner,'director');
  is_sup := public.has_role(_owner,'supervisor');
  IF NOT (is_gov OR is_cec OR is_co OR is_dir OR is_sup) THEN RETURN false; END IF;
  IF is_gov THEN RETURN true; END IF;

  IF is_cec THEN
    SELECT pc.status INTO parent_status FROM public.performance_contracts pc
      JOIN public.user_roles r ON r.user_id = pc.owner_id AND r.role='governor'
      ORDER BY pc.created_at DESC LIMIT 1;
  ELSIF is_co THEN
    SELECT pc.status INTO parent_status FROM public.performance_contracts pc
      JOIN public.user_roles r ON r.user_id = pc.owner_id AND r.role='cec'
      WHERE lower(coalesce(pc.department,''))=lower(coalesce(my_dept,''))
      ORDER BY pc.created_at DESC LIMIT 1;
  ELSIF is_dir THEN
    SELECT pc.status INTO parent_status FROM public.performance_contracts pc
      JOIN public.user_roles r ON r.user_id = pc.owner_id AND r.role='chief_officer'
      WHERE lower(coalesce(pc.department,''))=lower(coalesce(my_dept,''))
      ORDER BY pc.created_at DESC LIMIT 1;
  ELSIF is_sup THEN
    SELECT pc.status INTO parent_status FROM public.performance_contracts pc
      JOIN public.user_roles r ON r.user_id = pc.owner_id AND r.role='director'
      WHERE lower(coalesce(pc.department,''))=lower(coalesce(my_dept,''))
        AND lower(coalesce(pc.directorate,''))=lower(coalesce(my_dir,''))
      ORDER BY pc.created_at DESC LIMIT 1;
  END IF;

  RETURN parent_status IN ('signed','locked');
END $$;

-- Full 6-stage sign-off status
CREATE OR REPLACE FUNCTION public.department_signoff_status(_uid uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  emp_dept text; emp_dir text; sup_id uuid;
  gov jsonb; cec jsonb; co jsonb; dr jsonb; sup jsonb; wp jsonb;
  stages jsonb; ready boolean;
BEGIN
  SELECT department, directorate, supervisor_id INTO emp_dept, emp_dir, sup_id FROM public.profiles WHERE id=_uid;

  SELECT jsonb_build_object(
    'key','governor','label','Governor',
    'signer', p.full_name, 'position', COALESCE(p.designation,'Governor'),
    'department', p.department, 'directorate', p.directorate,
    'status', CASE WHEN pc.status IN ('signed','locked') THEN 'complete' ELSE 'pending' END,
    'signed_at', pc.signed_at,
    'signature', CASE WHEN pc.status IN ('signed','locked') THEN 'Digitally signed' ELSE 'Awaiting signature' END,
    'message', CASE WHEN pc.status IN ('signed','locked')
                    THEN 'Governor has approved the county Performance Contract.'
                    ELSE 'Awaiting Governor approval of the county Performance Contract.' END
  ) INTO gov
  FROM public.performance_contracts pc
  JOIN public.user_roles r ON r.user_id=pc.owner_id AND r.role='governor'
  JOIN public.profiles p ON p.id=pc.owner_id
  ORDER BY pc.created_at DESC LIMIT 1;

  SELECT jsonb_build_object(
    'key','cec','label','CEC Member',
    'signer', p.full_name, 'position', COALESCE(p.designation,'CEC Member'),
    'department', p.department, 'directorate', p.directorate,
    'status', CASE WHEN pc.status IN ('signed','locked') THEN 'complete' ELSE 'pending' END,
    'signed_at', pc.signed_at,
    'signature', CASE WHEN pc.status IN ('signed','locked') THEN 'Digitally signed' ELSE 'Awaiting signature' END,
    'message', CASE WHEN pc.status IN ('signed','locked')
                    THEN 'CEC has approved the Directorate Performance Contract.'
                    ELSE 'Awaiting CEC approval of the Directorate Performance Contract.' END
  ) INTO cec
  FROM public.performance_contracts pc
  JOIN public.user_roles r ON r.user_id=pc.owner_id AND r.role='cec'
  JOIN public.profiles p ON p.id=pc.owner_id
  WHERE lower(coalesce(pc.department,''))=lower(coalesce(emp_dept,''))
  ORDER BY pc.created_at DESC LIMIT 1;

  SELECT jsonb_build_object(
    'key','chief_officer','label','Chief Officer',
    'signer', p.full_name, 'position', COALESCE(p.designation,'Chief Officer'),
    'department', p.department, 'directorate', p.directorate,
    'status', CASE WHEN pc.status IN ('signed','locked') THEN 'complete' ELSE 'pending' END,
    'signed_at', pc.signed_at,
    'signature', CASE WHEN pc.status IN ('signed','locked') THEN 'Digitally signed' ELSE 'Awaiting signature' END,
    'message', CASE WHEN pc.status IN ('signed','locked')
                    THEN 'Chief Officer has approved the Directorate Performance Contract.'
                    ELSE 'Awaiting Chief Officer approval.' END
  ) INTO co
  FROM public.performance_contracts pc
  JOIN public.user_roles r ON r.user_id=pc.owner_id AND r.role='chief_officer'
  JOIN public.profiles p ON p.id=pc.owner_id
  WHERE lower(coalesce(pc.department,''))=lower(coalesce(emp_dept,''))
  ORDER BY pc.created_at DESC LIMIT 1;

  SELECT jsonb_build_object(
    'key','director','label','Director',
    'signer', p.full_name, 'position', COALESCE(p.designation,'Director'),
    'department', p.department, 'directorate', p.directorate,
    'status', CASE WHEN pc.status IN ('signed','locked') THEN 'complete' ELSE 'pending' END,
    'signed_at', pc.signed_at,
    'signature', CASE WHEN pc.status IN ('signed','locked') THEN 'Digitally signed' ELSE 'Awaiting signature' END,
    'message', CASE WHEN pc.status IN ('signed','locked')
                    THEN 'Director has approved the Department Performance Contract.'
                    ELSE 'Awaiting Director approval of the Department Performance Contract.' END
  ) INTO dr
  FROM public.performance_contracts pc
  JOIN public.user_roles r ON r.user_id=pc.owner_id AND r.role='director'
  JOIN public.profiles p ON p.id=pc.owner_id
  WHERE lower(coalesce(pc.department,''))=lower(coalesce(emp_dept,''))
    AND lower(coalesce(pc.directorate,''))=lower(coalesce(emp_dir,''))
  ORDER BY pc.created_at DESC LIMIT 1;

  SELECT jsonb_build_object(
    'key','supervisor','label','Supervisor',
    'signer', p.full_name, 'position', COALESCE(p.designation,'Supervisor'),
    'department', p.department, 'directorate', p.directorate,
    'status', CASE WHEN pc.status IN ('signed','locked') THEN 'complete' ELSE 'pending' END,
    'signed_at', pc.signed_at,
    'signature', CASE WHEN pc.status IN ('signed','locked') THEN 'Digitally signed' ELSE 'Awaiting signature' END,
    'message', CASE WHEN pc.status IN ('signed','locked')
                    THEN 'Supervisor has approved the Performance Contract.'
                    ELSE 'Awaiting Supervisor approval.' END
  ) INTO sup
  FROM public.performance_contracts pc
  JOIN public.profiles p ON p.id=pc.owner_id
  WHERE pc.owner_id = sup_id
  ORDER BY pc.created_at DESC LIMIT 1;

  SELECT jsonb_build_object(
    'key','workplan','label','Employee Workplan',
    'signer', p.full_name, 'position', COALESCE(p.designation,'Appraisee'),
    'department', p.department, 'directorate', p.directorate,
    'status', CASE WHEN COALESCE(w.status::text,'') IN ('approved','locked','signed','completed') THEN 'complete' ELSE 'pending' END,
    'signed_at', w.approved_at,
    'signature', CASE WHEN COALESCE(w.status::text,'') IN ('approved','locked','signed','completed') THEN 'Approved by supervisor' ELSE 'Awaiting supervisor approval' END,
    'message', CASE WHEN COALESCE(w.status::text,'') IN ('approved','locked','signed','completed')
                    THEN 'Your workplan has been approved by your supervisor.'
                    ELSE 'Your workplan is awaiting supervisor approval.' END
  ) INTO wp
  FROM public.profiles p
LEFT JOIN LATERAL (SELECT * FROM public.workplans w2 WHERE w2.assignee_id=p.id ORDER BY w2.created_at DESC LIMIT 1) w ON true
  WHERE p.id = _uid;

  stages := (SELECT COALESCE(jsonb_agg(x),'[]'::jsonb)
             FROM (VALUES (gov),(cec),(co),(dr),(sup),(wp)) t(x)
             WHERE x IS NOT NULL);

  ready := EXISTS (SELECT 1 FROM jsonb_array_elements(stages) e
                   WHERE e->>'key'='supervisor' AND e->>'status'='complete');

  RETURN jsonb_build_object(
    'department', emp_dept,
    'directorate', emp_dir,
    'ready_for_appraisal', ready,
    'stages', stages
  );
END $$;

GRANT EXECUTE ON FUNCTION public.department_signoff_status(uuid) TO authenticated;

-- Hierarchy reports: direct reports at the actor's level
CREATE OR REPLACE FUNCTION public.hierarchy_reports(_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_gov boolean; is_cec boolean; is_co boolean; is_dir boolean; is_sup boolean;
  my_dept text; my_dir text;
  rows jsonb := '[]'::jsonb;
  actor_level text := 'none';
BEGIN
  is_gov := public.has_role(_actor,'governor');
  is_cec := public.has_role(_actor,'cec');
  is_co  := public.has_role(_actor,'chief_officer');
  is_dir := public.has_role(_actor,'director');
  is_sup := public.has_role(_actor,'supervisor');
  SELECT department, directorate INTO my_dept, my_dir FROM public.profiles WHERE id = _actor;

  IF is_gov THEN
    actor_level := 'governor';
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'user_id', p.id, 'full_name', p.full_name, 'designation', COALESCE(p.designation,'CEC Member'),
      'department', p.department, 'directorate', p.directorate,
      'contract_id', pc.id, 'contract_status', pc.status, 'signed_at', pc.signed_at
    ) ORDER BY p.department, p.full_name), '[]'::jsonb) INTO rows
    FROM public.user_roles r JOIN public.profiles p ON p.id=r.user_id
    LEFT JOIN LATERAL (SELECT * FROM public.performance_contracts pc2 WHERE pc2.owner_id=p.id ORDER BY pc2.created_at DESC LIMIT 1) pc ON true
    WHERE r.role='cec';
  ELSIF is_cec THEN
    actor_level := 'cec';
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'user_id', p.id, 'full_name', p.full_name, 'designation', COALESCE(p.designation,'Chief Officer'),
      'department', p.department, 'directorate', p.directorate,
      'contract_id', pc.id, 'contract_status', pc.status, 'signed_at', pc.signed_at
    ) ORDER BY p.full_name), '[]'::jsonb) INTO rows
    FROM public.user_roles r JOIN public.profiles p ON p.id=r.user_id
    LEFT JOIN LATERAL (SELECT * FROM public.performance_contracts pc2 WHERE pc2.owner_id=p.id ORDER BY pc2.created_at DESC LIMIT 1) pc ON true
    WHERE r.role='chief_officer' AND lower(coalesce(p.department,''))=lower(coalesce(my_dept,''));
  ELSIF is_co THEN
    actor_level := 'chief_officer';
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'user_id', p.id, 'full_name', p.full_name, 'designation', COALESCE(p.designation,'Director'),
      'department', p.department, 'directorate', p.directorate,
      'contract_id', pc.id, 'contract_status', pc.status, 'signed_at', pc.signed_at
    ) ORDER BY p.full_name), '[]'::jsonb) INTO rows
    FROM public.user_roles r JOIN public.profiles p ON p.id=r.user_id
    LEFT JOIN LATERAL (SELECT * FROM public.performance_contracts pc2 WHERE pc2.owner_id=p.id ORDER BY pc2.created_at DESC LIMIT 1) pc ON true
    WHERE r.role='director' AND lower(coalesce(p.department,''))=lower(coalesce(my_dept,''));
  ELSIF is_dir THEN
    actor_level := 'director';
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'user_id', p.id, 'full_name', p.full_name, 'designation', COALESCE(p.designation,'Supervisor'),
      'department', p.department, 'directorate', p.directorate,
      'contract_id', pc.id, 'contract_status', pc.status, 'signed_at', pc.signed_at
    ) ORDER BY p.full_name), '[]'::jsonb) INTO rows
    FROM public.user_roles r JOIN public.profiles p ON p.id=r.user_id
    LEFT JOIN LATERAL (SELECT * FROM public.performance_contracts pc2 WHERE pc2.owner_id=p.id ORDER BY pc2.created_at DESC LIMIT 1) pc ON true
    WHERE r.role='supervisor'
      AND lower(coalesce(p.department,''))=lower(coalesce(my_dept,''))
      AND lower(coalesce(p.directorate,''))=lower(coalesce(my_dir,''));
  ELSIF is_sup THEN
    actor_level := 'supervisor';
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'user_id', p.id, 'full_name', p.full_name, 'designation', COALESCE(p.designation,'Appraisee'),
      'department', p.department, 'directorate', p.directorate,
      'workplan_id', w.id, 'workplan_status', w.status
    ) ORDER BY p.full_name), '[]'::jsonb) INTO rows
    FROM public.profiles p
    LEFT JOIN LATERAL (SELECT * FROM public.workplans w2 WHERE w2.assignee_id=p.id ORDER BY w2.created_at DESC LIMIT 1) w ON true
  END IF;

  RETURN jsonb_build_object('level', actor_level, 'reports', rows);
END $$;

GRANT EXECUTE ON FUNCTION public.hierarchy_reports(uuid) TO authenticated;


-- ─────────────────────────────────────────────────────────────
-- Migration: 20260713074936_cee0dead-f67c-4156-837f-457e762f2700.sql
-- ─────────────────────────────────────────────────────────────

-- 1) Entity type enum
DO $$ BEGIN
  CREATE TYPE public.contract_entity_type AS ENUM ('county_government','county_executive_board','county_public_office');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) performance_contracts.entity_type
ALTER TABLE public.performance_contracts
  ADD COLUMN IF NOT EXISTS entity_type public.contract_entity_type NOT NULL DEFAULT 'county_government';

-- 3) Source column on matrix + contract objectives
ALTER TABLE public.performance_matrix   ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.contract_objectives  ADD COLUMN IF NOT EXISTS source text;

-- 4) matrix_sources table (dept-scoped dropdown values)
CREATE TABLE IF NOT EXISTS public.matrix_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department text NOT NULL,
  label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (department, label)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.matrix_sources TO authenticated;
GRANT ALL ON public.matrix_sources TO service_role;

ALTER TABLE public.matrix_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "matrix_sources_read" ON public.matrix_sources;
CREATE POLICY "matrix_sources_read" ON public.matrix_sources
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "matrix_sources_write" ON public.matrix_sources;
CREATE POLICY "matrix_sources_write" ON public.matrix_sources
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'system_admin')
    OR public.has_role(auth.uid(),'super_admin')
    OR public.has_role_in_dept(auth.uid(),'dept_admin', department)
  )
  WITH CHECK (
    public.has_role(auth.uid(),'system_admin')
    OR public.has_role(auth.uid(),'super_admin')
    OR public.has_role_in_dept(auth.uid(),'dept_admin', department)
  );

DROP TRIGGER IF EXISTS matrix_sources_touch ON public.matrix_sources;
CREATE TRIGGER matrix_sources_touch BEFORE UPDATE ON public.matrix_sources
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 5) Seed common source values for every known department (idempotent)
INSERT INTO public.matrix_sources (department, label, sort_order)
SELECT d.department, s.label, s.ord
FROM (SELECT DISTINCT department FROM public.performance_matrix WHERE department IS NOT NULL) d
CROSS JOIN (VALUES
  ('CIDP',1),('Governor''s Manifesto',2),('ADP',3),('Strategic Plan',4),
  ('Annual Work Plan',5),('Finance Act',6),('Departmental Strategic Objectives',7),
  ('Cabinet Resolution',8),('National Government Directive',9),('Other Approved Source',10)
) AS s(label,ord)
ON CONFLICT (department,label) DO NOTHING;

-- 6) Entity-aware hierarchy gate
CREATE OR REPLACE FUNCTION public.can_start_contract(_owner uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  my_dept text; my_dir text;
  is_gov boolean; is_cec boolean; is_co boolean; is_dir boolean; is_sup boolean;
  parent_status public.contract_status;
  entity public.contract_entity_type;
BEGIN
  SELECT department, directorate INTO my_dept, my_dir FROM public.profiles WHERE id = _owner;
  is_gov := public.has_role(_owner,'governor');
  is_cec := public.has_role(_owner,'cec');
  is_co  := public.has_role(_owner,'chief_officer');
  is_dir := public.has_role(_owner,'director');
  is_sup := public.has_role(_owner,'supervisor');
  IF NOT (is_gov OR is_cec OR is_co OR is_dir OR is_sup) THEN RETURN false; END IF;
  IF is_gov THEN RETURN true; END IF;

  -- pick entity from user's most recent contract; default county_government
  SELECT pc.entity_type INTO entity FROM public.performance_contracts pc
    WHERE pc.owner_id=_owner ORDER BY pc.created_at DESC LIMIT 1;
  entity := COALESCE(entity, 'county_government');

  IF is_cec THEN
    IF entity IN ('county_executive_board') THEN RETURN true; END IF;
    SELECT pc.status INTO parent_status FROM public.performance_contracts pc
      JOIN public.user_roles r ON r.user_id = pc.owner_id AND r.role='governor'
      ORDER BY pc.created_at DESC LIMIT 1;
  ELSIF is_co THEN
    IF entity = 'county_public_office' THEN RETURN true; END IF;
    SELECT pc.status INTO parent_status FROM public.performance_contracts pc
      JOIN public.user_roles r ON r.user_id = pc.owner_id AND r.role='cec'
      WHERE lower(coalesce(pc.department,''))=lower(coalesce(my_dept,''))
      ORDER BY pc.created_at DESC LIMIT 1;
  ELSIF is_dir THEN
    SELECT pc.status INTO parent_status FROM public.performance_contracts pc
      JOIN public.user_roles r ON r.user_id = pc.owner_id AND r.role='chief_officer'
      WHERE lower(coalesce(pc.department,''))=lower(coalesce(my_dept,''))
      ORDER BY pc.created_at DESC LIMIT 1;
  ELSIF is_sup THEN
    SELECT pc.status INTO parent_status FROM public.performance_contracts pc
      JOIN public.user_roles r ON r.user_id = pc.owner_id AND r.role='director'
      WHERE lower(coalesce(pc.department,''))=lower(coalesce(my_dept,''))
        AND lower(coalesce(pc.directorate,''))=lower(coalesce(my_dir,''))
      ORDER BY pc.created_at DESC LIMIT 1;
  END IF;

  RETURN parent_status IN ('signed','locked');
END $function$;


-- ─────────────────────────────────────────────────────────────
-- Migration: 20260715073028_f91acb75-eb09-4a36-a64a-993d8c678b8b.sql
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.departments
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.contract_signoffs
  ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_contract_signoffs_contract_owner
  ON public.contract_signoffs (contract_id, is_owner);


-- ─────────────────────────────────────────────────────────────
-- Migration: 20260720120000_enhancements_v1.sql
-- ─────────────────────────────────────────────────────────────
-- =============================================================
-- EPMS / SPAS Enhancements – Performance Contract, Workplans & Reports
-- 2026-07-20
-- =============================================================

-- ─────────────────────────────────────────────────────────────
-- 1.  Add current_status to performance_matrix
-- ─────────────────────────────────────────────────────────────
ALTER TABLE performance_matrix ADD COLUMN IF NOT EXISTS current_status text;

-- ─────────────────────────────────────────────────────────────
-- 2.  Add current_status to contract_objectives
-- ─────────────────────────────────────────────────────────────
ALTER TABLE contract_objectives ADD COLUMN IF NOT EXISTS current_status text;

-- ─────────────────────────────────────────────────────────────
-- 3.  Performance categories  (replaces hardcoded CATEGORIES)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS performance_categories (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  department        text        NOT NULL,
  category_key      text        NOT NULL,
  label             text        NOT NULL,
  recommended_weight numeric    NOT NULL DEFAULT 20,
  description       text,
  guidance          text,
  sort_order        integer     NOT NULL DEFAULT 0,
  is_active         boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (department, category_key)
);

ALTER TABLE performance_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_performance_categories"
  ON performance_categories FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_write_performance_categories"
  ON performance_categories FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Seed the 5 default categories for every department that already has
-- rows in performance_matrix.
INSERT INTO performance_categories
  (department, category_key, label, recommended_weight, sort_order)
SELECT DISTINCT
  pm.department,
  v.category_key,
  v.label,
  v.recommended_weight,
  v.sort_order
FROM performance_matrix pm
CROSS JOIN (VALUES
  ('financial_stewardship',        'Financial Stewardship and Discipline', 20, 1),
  ('service_delivery',             'Service Delivery',                     25, 2),
  ('institutional_transformation', 'Institutional Transformation',         20, 3),
  ('core_mandate',                 'Core Mandate',                         25, 4),
  ('cross_cutting',                'Cross-Cutting Issues',                 10, 5)
) AS v(category_key, label, recommended_weight, sort_order)
ON CONFLICT (department, category_key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 4.  Configurable Current Status options (per department)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matrix_status_options (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  department text        NOT NULL,
  label      text        NOT NULL,
  sort_order integer     NOT NULL DEFAULT 0,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (department, label)
);

ALTER TABLE matrix_status_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_matrix_status_options"
  ON matrix_status_options FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_write_matrix_status_options"
  ON matrix_status_options FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Seed default status options for every existing department
INSERT INTO matrix_status_options (department, label, sort_order)
SELECT DISTINCT pm.department, v.label, v.sort_order
FROM performance_matrix pm
CROSS JOIN (VALUES
  ('Not Started', 1),
  ('In Progress', 2),
  ('Completed',   3),
  ('Ongoing',     4),
  ('Delayed',     5),
  ('Deferred',    6)
) AS v(label, sort_order)
ON CONFLICT (department, label) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 5.  Workplan workflow fields
-- ─────────────────────────────────────────────────────────────
ALTER TABLE workplans ADD COLUMN IF NOT EXISTS submission_note text;
ALTER TABLE workplans ADD COLUMN IF NOT EXISTS reviewer_comment text;
-- The 'status' column (text) already exists.
-- Supported workflow values: draft | submitted | approved | returned

-- ─────────────────────────────────────────────────────────────
-- 6.  Signature image upload support
-- ─────────────────────────────────────────────────────────────
ALTER TABLE contract_signoffs ADD COLUMN IF NOT EXISTS signature_image_path text;

-- ─────────────────────────────────────────────────────────────
-- NOTE: Create a Supabase Storage bucket called "signatures"
-- (public: false, file size limit: 10 MB) via the Supabase
-- dashboard or CLI before using signature image upload.
-- ─────────────────────────────────────────────────────────────

