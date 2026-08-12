
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
