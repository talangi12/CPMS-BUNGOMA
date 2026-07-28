
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
