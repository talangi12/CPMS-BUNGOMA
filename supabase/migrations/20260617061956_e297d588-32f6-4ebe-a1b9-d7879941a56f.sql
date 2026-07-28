
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
