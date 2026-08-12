-- Add External Assessor as a role and grant oversight read-only access.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'public.app_role'::regtype
      AND enumlabel = 'external_assessor'
  ) THEN
    ALTER TYPE public.app_role ADD VALUE 'external_assessor';
  END IF;
END $$;

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
      AND role IN (
        'hr', 'system_admin', 'super_admin', 'governor', 'cec',
        'chief_officer', 'director', 'dept_admin', 'admin',
        'county_administrator', 'department_head', 'external_assessor'
      )
  )
$$;
GRANT EXECUTE ON FUNCTION public.is_admin_viewer(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_view_profile(_actor uuid, _target uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_sys boolean;
  t record;
  actor_dept text;
  actor_dir text;
BEGIN
  IF _actor = _target THEN
    RETURN true;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _actor AND role IN ('system_admin','super_admin','hr','external_assessor')
  ) INTO is_sys;
  IF is_sys THEN
    RETURN true;
  END IF;

  SELECT department, directorate, supervisor_id INTO t
  FROM public.profiles
  WHERE id = _target;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _actor AND role = 'governor') THEN
    RETURN true;
  END IF;

  actor_dept := public.user_role_dept(_actor, 'cec'::public.app_role);
  IF actor_dept IS NOT NULL AND lower(actor_dept) = lower(coalesce(t.department, '')) THEN
    RETURN true;
  END IF;

  actor_dept := public.user_role_dept(_actor, 'chief_officer'::public.app_role);
  IF actor_dept IS NOT NULL AND lower(actor_dept) = lower(coalesce(t.department, '')) THEN
    RETURN true;
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _actor AND role = 'director') THEN
    SELECT department, directorate INTO actor_dept, actor_dir FROM public.profiles WHERE id = _actor;
    IF lower(coalesce(actor_dept, '')) = lower(coalesce(t.department, ''))
       AND lower(coalesce(actor_dir, '')) = lower(coalesce(t.directorate, '')) THEN
      RETURN true;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _actor AND role = 'supervisor')
     AND t.supervisor_id = _actor THEN
    RETURN true;
  END IF;

  RETURN false;
END
$$;
GRANT EXECUTE ON FUNCTION public.can_view_profile(uuid, uuid) TO authenticated;

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
                 AND role IN ('governor','cec','system_admin','super_admin','hr','external_assessor')) INTO is_county;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid AND role='chief_officer') INTO is_co;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid AND role='director')      INTO is_director;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid AND role='supervisor')    INTO is_sup;
  SELECT department, directorate INTO my_dept, my_dir FROM public.profiles WHERE id=_uid;

  IF is_county THEN
    SELECT count(*) FILTER (WHERE status='submitted'),
           count(*) FILTER (WHERE status='approved'),
           count(*) FILTER (WHERE status='rejected'),
           count(*) FILTER (WHERE status='submitted' AND escalated_at IS NOT NULL'),
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
          WHERE a.status = 'submitted' AND a.escalated_at IS NOT NULL
          GROUP BY p.department ORDER BY overdue DESC LIMIT 5
        ) t
      )
    );
  ELSIF is_co THEN
    SELECT count(*) FILTER (WHERE a.status='submitted'),
           count(*) FILTER (WHERE a.status='approved'),
           count(*) FILTER (WHERE a.status='rejected'),
           count(*) FILTER (WHERE a.status='submitted' AND a.escalated_at IS NOT NULL'),
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
           count(*) FILTER (WHERE a.status='submitted' AND a.escalated_at IS NOT NULL'),
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
           count(*) FILTER (WHERE status='submitted' AND escalated_at IS NOT NULL'),
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
           count(*) FILTER (WHERE status='submitted' AND escalated_at IS NOT NULL'),
           count(*)
    INTO submitted, approved, returned, escalated, total
    FROM public.appraisals WHERE employee_id=_uid;
    completion := CASE WHEN total>0 THEN ROUND(approved::numeric/total*100,1) ELSE 0 END;
    result := jsonb_build_object('scope','self',
      'total',total,'submitted',submitted,'approved',approved,
      'returned',returned,'escalated',escalated,'completion_pct',completion);
  END IF;

  RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION public.dashboard_stats_for_role(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.department_progress_for_role(_uid uuid, _cycle_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_county boolean;
  is_co boolean;
  is_director boolean;
  is_sup boolean;
  my_dept text;
  my_dir text;
  progress jsonb;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid
    AND role IN ('governor','cec','system_admin','super_admin','hr','external_assessor')) INTO is_county;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid AND role='chief_officer') INTO is_co;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid AND role='director') INTO is_director;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid AND role='supervisor') INTO is_sup;
  SELECT department, directorate INTO my_dept, my_dir FROM public.profiles WHERE id=_uid;

  IF is_county THEN
    RETURN (SELECT jsonb_agg(t) FROM (
      SELECT jsonb_build_object(
        'scope', 'county', 'rows', COALESCE(jsonb_agg(jsonb_build_object(
          'department', department,
          'directorate', directorate,
          'employees', employees,
          'submitted', submitted,
          'approved', approved,
          'pending', pending,
          'escalated', escalated,
          'completion_pct', completion_pct
        ) ORDER BY department), '[]'::jsonb)
      )
      FROM (SELECT NULL) x
    ) t);
  END IF;

  RETURN '[]'::jsonb;
END $$;
GRANT EXECUTE ON FUNCTION public.department_progress_for_role(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.top_performers_for_role(_uid uuid, _cycle_id uuid DEFAULT NULL, _limit int DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_county boolean; is_co boolean; is_director boolean;
  my_dept text; my_dir text;
  result jsonb;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid
    AND role IN ('governor','cec','system_admin','super_admin','hr','external_assessor')) INTO is_county;
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
