
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
  IF TG_OP = 'INSERT' THEN
    IF NOT public.has_signed_contract(NEW.employee_id) THEN
      RAISE EXCEPTION 'You must complete and sign your Performance Contract before starting an appraisal.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
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
