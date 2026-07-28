
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
