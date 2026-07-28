-- Phase 1: SPAS Foundations — Form 5 workplan structure, Additional Assignments, Report numbering

-- 1) Extend workplans for full CGB/SPA Form 5 shape
ALTER TABLE public.workplans
  ADD COLUMN IF NOT EXISTS resources_required text,
  ADD COLUMN IF NOT EXISTS workplan_type text NOT NULL DEFAULT 'annual' CHECK (workplan_type IN ('annual','quarterly')),
  ADD COLUMN IF NOT EXISTS quarter smallint CHECK (quarter BETWEEN 1 AND 4),
  ADD COLUMN IF NOT EXISTS reporting_period text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS parent_workplan_id uuid REFERENCES public.workplans(id) ON DELETE SET NULL;

-- 2) Workplan version history (snapshot of each edit)
CREATE TABLE IF NOT EXISTS public.workplan_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workplan_id uuid NOT NULL REFERENCES public.workplans(id) ON DELETE CASCADE,
  version int NOT NULL,
  snapshot jsonb NOT NULL,
  changed_by uuid REFERENCES auth.users(id),
  change_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.workplan_versions TO authenticated;
GRANT ALL ON public.workplan_versions TO service_role;
ALTER TABLE public.workplan_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wp_versions_view" ON public.workplan_versions FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.workplans w WHERE w.id = workplan_id AND (w.assignee_id=auth.uid() OR w.assigned_by=auth.uid() OR public.is_admin_viewer(auth.uid()))));
CREATE POLICY "wp_versions_insert" ON public.workplan_versions FOR INSERT TO authenticated
WITH CHECK (EXISTS(SELECT 1 FROM public.workplans w WHERE w.id = workplan_id AND w.assigned_by=auth.uid()));

-- 3) Additional Assignments (outside original workplan)
CREATE TABLE IF NOT EXISTS public.additional_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  supervisor_id uuid NOT NULL REFERENCES auth.users(id),
  appraisal_id uuid REFERENCES public.appraisals(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  date_assigned date NOT NULL DEFAULT current_date,
  due_date date,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','cancelled')),
  achievement_summary text,
  evidence_path text,
  completed_at timestamptz,
  quarter smallint CHECK (quarter BETWEEN 1 AND 4),
  period text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.additional_assignments TO authenticated;
GRANT ALL ON public.additional_assignments TO service_role;
ALTER TABLE public.additional_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aa_view" ON public.additional_assignments FOR SELECT TO authenticated
USING (employee_id=auth.uid() OR supervisor_id=auth.uid() OR public.is_admin_viewer(auth.uid())
       OR public.can_view_profile(auth.uid(), employee_id));
CREATE POLICY "aa_supervisor_manage" ON public.additional_assignments FOR ALL TO authenticated
USING (supervisor_id=auth.uid() OR public.is_admin_viewer(auth.uid()))
WITH CHECK (supervisor_id=auth.uid() OR public.is_admin_viewer(auth.uid()));
CREATE POLICY "aa_employee_update_own" ON public.additional_assignments FOR UPDATE TO authenticated
USING (employee_id=auth.uid()) WITH CHECK (employee_id=auth.uid());
CREATE TRIGGER aa_touch BEFORE UPDATE ON public.additional_assignments FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4) Report Registry with auto-numbering CGB/SPAS/YYYY/QN/NNNNNN
CREATE SEQUENCE IF NOT EXISTS public.report_number_seq;

CREATE TABLE IF NOT EXISTS public.report_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_number text NOT NULL UNIQUE,
  report_type text NOT NULL CHECK (report_type IN ('form2_quarterly','form3_departmental','form4_cipmc','form5_workplan','annual_summary','other')),
  cycle_id uuid REFERENCES public.appraisal_cycles(id),
  department text,
  directorate text,
  quarter smallint,
  fiscal_year text,
  related_appraisal_id uuid REFERENCES public.appraisals(id) ON DELETE SET NULL,
  related_workplan_id uuid REFERENCES public.workplans(id) ON DELETE SET NULL,
  related_employee_id uuid REFERENCES auth.users(id),
  pdf_path text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_by uuid REFERENCES auth.users(id),
  generated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.report_registry TO authenticated;
GRANT ALL ON public.report_registry TO service_role;
ALTER TABLE public.report_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reports_view" ON public.report_registry FOR SELECT TO authenticated
USING (public.is_admin_viewer(auth.uid())
       OR generated_by=auth.uid()
       OR related_employee_id=auth.uid()
       OR EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid()
                 AND role IN ('director','chief_officer','cec','governor','appeals_committee')));
CREATE POLICY "reports_insert" ON public.report_registry FOR INSERT TO authenticated
WITH CHECK (generated_by = auth.uid());

CREATE OR REPLACE FUNCTION public.next_report_number(_type text, _quarter smallint DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  yr text := to_char(now(),'YYYY');
  q text := CASE WHEN _quarter IS NULL THEN 'A' ELSE 'Q'||_quarter::text END;
  n bigint;
BEGIN
  n := nextval('public.report_number_seq');
  RETURN 'CGB/SPAS/' || yr || '/' || q || '/' || lpad(n::text, 6, '0');
END $$;

-- 5) Report sign-offs (typed digital signatures)
CREATE TABLE IF NOT EXISTS public.report_signoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.report_registry(id) ON DELETE CASCADE,
  signer_id uuid NOT NULL REFERENCES auth.users(id),
  signer_name text NOT NULL,
  signer_position text NOT NULL,
  stage text NOT NULL CHECK (stage IN ('employee','supervisor','director','chief_officer','cipmc','cec','governor')),
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','rejected','pending')),
  remarks text,
  signed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.report_signoffs TO authenticated;
GRANT ALL ON public.report_signoffs TO service_role;
ALTER TABLE public.report_signoffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "signoffs_view" ON public.report_signoffs FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.report_registry r WHERE r.id = report_id
              AND (r.generated_by=auth.uid() OR r.related_employee_id=auth.uid() OR public.is_admin_viewer(auth.uid())
                   OR EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid()
                             AND role IN ('director','chief_officer','cec','governor','appeals_committee')))));
CREATE POLICY "signoffs_insert" ON public.report_signoffs FOR INSERT TO authenticated
WITH CHECK (signer_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_report_registry_type ON public.report_registry(report_type, fiscal_year, quarter);
CREATE INDEX IF NOT EXISTS idx_report_registry_dept ON public.report_registry(department);
CREATE INDEX IF NOT EXISTS idx_aa_employee ON public.additional_assignments(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_aa_supervisor ON public.additional_assignments(supervisor_id);