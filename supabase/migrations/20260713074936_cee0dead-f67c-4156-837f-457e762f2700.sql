
-- 1) Entity type enum
DO $$ BEGIN
  CREATE TYPE public.contract_entity_type AS ENUM ('county_government','county_executive_board','county_public_office');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) performance_contracts.entity_type
ALTER TABLE public.performance_contracts
  ADD COLUMN IF NOT EXISTS entity_type public.contract_entity_type NOT NULL DEFAULT 'county_government';

-- 3) Source column on matrix + contract objectives
ALTER TABLE public.performance_matrix   ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.contract_objectives  ADD COLUMN IF NOT EXISTS source text;

-- 4) matrix_sources table (dept-scoped dropdown values)
CREATE TABLE IF NOT EXISTS public.matrix_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department text NOT NULL,
  label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (department, label)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.matrix_sources TO authenticated;
GRANT ALL ON public.matrix_sources TO service_role;

ALTER TABLE public.matrix_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "matrix_sources_read" ON public.matrix_sources;
CREATE POLICY "matrix_sources_read" ON public.matrix_sources
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "matrix_sources_write" ON public.matrix_sources;
CREATE POLICY "matrix_sources_write" ON public.matrix_sources
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'system_admin')
    OR public.has_role(auth.uid(),'super_admin')
    OR public.has_role_in_dept(auth.uid(),'dept_admin', department)
  )
  WITH CHECK (
    public.has_role(auth.uid(),'system_admin')
    OR public.has_role(auth.uid(),'super_admin')
    OR public.has_role_in_dept(auth.uid(),'dept_admin', department)
  );

DROP TRIGGER IF EXISTS matrix_sources_touch ON public.matrix_sources;
CREATE TRIGGER matrix_sources_touch BEFORE UPDATE ON public.matrix_sources
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 5) Seed common source values for every known department (idempotent)
INSERT INTO public.matrix_sources (department, label, sort_order)
SELECT d.department, s.label, s.ord
FROM (SELECT DISTINCT department FROM public.performance_matrix WHERE department IS NOT NULL) d
CROSS JOIN (VALUES
  ('CIDP',1),('Governor''s Manifesto',2),('ADP',3),('Strategic Plan',4),
  ('Annual Work Plan',5),('Finance Act',6),('Departmental Strategic Objectives',7),
  ('Cabinet Resolution',8),('National Government Directive',9),('Other Approved Source',10)
) AS s(label,ord)
ON CONFLICT (department,label) DO NOTHING;

-- 6) Entity-aware hierarchy gate
CREATE OR REPLACE FUNCTION public.can_start_contract(_owner uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  my_dept text; my_dir text;
  is_gov boolean; is_cec boolean; is_co boolean; is_dir boolean; is_sup boolean;
  parent_status public.contract_status;
  entity public.contract_entity_type;
BEGIN
  SELECT department, directorate INTO my_dept, my_dir FROM public.profiles WHERE id = _owner;
  is_gov := public.has_role(_owner,'governor');
  is_cec := public.has_role(_owner,'cec');
  is_co  := public.has_role(_owner,'chief_officer');
  is_dir := public.has_role(_owner,'director');
  is_sup := public.has_role(_owner,'supervisor');
  IF NOT (is_gov OR is_cec OR is_co OR is_dir OR is_sup) THEN RETURN false; END IF;
  IF is_gov THEN RETURN true; END IF;

  -- pick entity from user's most recent contract; default county_government
  SELECT pc.entity_type INTO entity FROM public.performance_contracts pc
    WHERE pc.owner_id=_owner ORDER BY pc.created_at DESC LIMIT 1;
  entity := COALESCE(entity, 'county_government');

  IF is_cec THEN
    IF entity IN ('county_executive_board') THEN RETURN true; END IF;
    SELECT pc.status INTO parent_status FROM public.performance_contracts pc
      JOIN public.user_roles r ON r.user_id = pc.owner_id AND r.role='governor'
      ORDER BY pc.created_at DESC LIMIT 1;
  ELSIF is_co THEN
    IF entity = 'county_public_office' THEN RETURN true; END IF;
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
END $function$;
