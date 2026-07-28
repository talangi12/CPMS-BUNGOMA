
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
