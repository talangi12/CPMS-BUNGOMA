CREATE OR REPLACE FUNCTION public.hierarchy_reports(_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_gov boolean := false;
  is_cec boolean := false;
  is_co boolean := false;
  is_dir boolean := false;
  is_sup boolean := false;
  my_dept text;
  my_dir text;
  rows jsonb := '[]'::jsonb;
  actor_level text := 'none';
BEGIN

  /*
   * Determine roles directly from user_roles.
   * This avoids hierarchy_reports depending on another role helper
   * returning an unexpected result.
   */
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _actor AND role = 'governor'
  ) INTO is_gov;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _actor AND role = 'cec'
  ) INTO is_cec;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _actor AND role = 'chief_officer'
  ) INTO is_co;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _actor AND role = 'director'
  ) INTO is_dir;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _actor AND role = 'supervisor'
  ) INTO is_sup;

  SELECT department, directorate
  INTO my_dept, my_dir
  FROM public.profiles
  WHERE id = _actor
  LIMIT 1;

  /*
   * GOVERNOR -> CECs
   */
  IF is_gov THEN

    actor_level := 'governor';

    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'user_id', p.id,
          'full_name', p.full_name,
          'designation', COALESCE(p.designation, 'CEC Member'),
          'department', p.department,
          'directorate', p.directorate,
          'contract_id', pc.id,
          'contract_status', pc.status,
          'signed_at', pc.signed_at
        )
        ORDER BY p.department, p.full_name
      ),
      '[]'::jsonb
    )
    INTO rows
    FROM public.user_roles r
    JOIN public.profiles p ON p.id = r.user_id
    LEFT JOIN LATERAL (
      SELECT *
      FROM public.performance_contracts pc2
      WHERE pc2.owner_id = p.id
      ORDER BY pc2.created_at DESC
      LIMIT 1
    ) pc ON true
    WHERE r.role = 'cec';

  /*
   * CEC -> Chief Officers
   */
  ELSIF is_cec THEN

    actor_level := 'cec';

    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'user_id', p.id,
          'full_name', p.full_name,
          'designation', COALESCE(p.designation, 'Chief Officer'),
          'department', p.department,
          'directorate', p.directorate,
          'contract_id', pc.id,
          'contract_status', pc.status,
          'signed_at', pc.signed_at
        )
        ORDER BY p.full_name
      ),
      '[]'::jsonb
    )
    INTO rows
    FROM public.user_roles r
    JOIN public.profiles p ON p.id = r.user_id
    LEFT JOIN LATERAL (
      SELECT *
      FROM public.performance_contracts pc2
      WHERE pc2.owner_id = p.id
      ORDER BY pc2.created_at DESC
      LIMIT 1
    ) pc ON true
    WHERE r.role = 'chief_officer'
      AND (
        my_dept IS NULL
        OR lower(coalesce(p.department, '')) = lower(my_dept)
      );

  /*
   * CHIEF OFFICER -> Directors
   */
  ELSIF is_co THEN

    actor_level := 'chief_officer';

    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'user_id', p.id,
          'full_name', p.full_name,
          'designation', COALESCE(p.designation, 'Director'),
          'department', p.department,
          'directorate', p.directorate,
          'contract_id', pc.id,
          'contract_status', pc.status,
          'signed_at', pc.signed_at
        )
        ORDER BY p.full_name
      ),
      '[]'::jsonb
    )
    INTO rows
    FROM public.user_roles r
    JOIN public.profiles p ON p.id = r.user_id
    LEFT JOIN LATERAL (
      SELECT *
      FROM public.performance_contracts pc2
      WHERE pc2.owner_id = p.id
      ORDER BY pc2.created_at DESC
      LIMIT 1
    ) pc ON true
    WHERE r.role = 'director'
      AND (
        my_dept IS NULL
        OR lower(coalesce(p.department, '')) = lower(my_dept)
      );

  /*
   * DIRECTOR -> Supervisors
   */
  ELSIF is_dir THEN

    actor_level := 'director';

    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'user_id', p.id,
          'full_name', p.full_name,
          'designation', COALESCE(p.designation, 'Supervisor'),
          'department', p.department,
          'directorate', p.directorate,
          'contract_id', pc.id,
          'contract_status', pc.status,
          'signed_at', pc.signed_at
        )
        ORDER BY p.full_name
      ),
      '[]'::jsonb
    )
    INTO rows
    FROM public.user_roles r
    JOIN public.profiles p ON p.id = r.user_id
    LEFT JOIN LATERAL (
      SELECT *
      FROM public.performance_contracts pc2
      WHERE pc2.owner_id = p.id
      ORDER BY pc2.created_at DESC
      LIMIT 1
    ) pc ON true
    WHERE r.role = 'supervisor'
      AND (
        my_dept IS NULL
        OR lower(coalesce(p.department, '')) = lower(my_dept)
      )
      AND (
        my_dir IS NULL
        OR lower(coalesce(p.directorate, '')) = lower(my_dir)
      );

  /*
   * SUPERVISOR -> Employees
   */
  ELSIF is_sup THEN

    actor_level := 'supervisor';

    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'user_id', p.id,
          'full_name', p.full_name,
          'designation', COALESCE(p.designation, 'Appraisee'),
          'department', p.department,
          'directorate', p.directorate,
          'workplan_id', w.id,
          'workplan_status', w.status
        )
        ORDER BY p.full_name
      ),
      '[]'::jsonb
    )
    INTO rows
    FROM public.profiles p
    LEFT JOIN LATERAL (
      SELECT *
      FROM public.workplans w2
      WHERE w2.employee_id = p.id
      ORDER BY w2.created_at DESC
      LIMIT 1
    ) w ON true
    WHERE p.supervisor_id = _actor
      AND coalesce(p.employee_status::text, 'active') = 'active';

  END IF;

  RETURN jsonb_build_object(
    'level', actor_level,
    'reports', rows
  );

END;
$$;

GRANT EXECUTE ON FUNCTION public.hierarchy_reports(uuid) TO authenticated;
