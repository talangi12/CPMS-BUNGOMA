
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
  LEFT JOIN LATERAL (SELECT * FROM public.workplans w2 WHERE w2.employee_id=p.id ORDER BY w2.created_at DESC LIMIT 1) w ON true
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
    LEFT JOIN LATERAL (SELECT * FROM public.workplans w2 WHERE w2.employee_id=p.id ORDER BY w2.created_at DESC LIMIT 1) w ON true
    WHERE p.supervisor_id = _actor AND coalesce(p.employee_status::text,'active')='active';
  END IF;

  RETURN jsonb_build_object('level', actor_level, 'reports', rows);
END $$;

GRANT EXECUTE ON FUNCTION public.hierarchy_reports(uuid) TO authenticated;
