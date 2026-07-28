
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
