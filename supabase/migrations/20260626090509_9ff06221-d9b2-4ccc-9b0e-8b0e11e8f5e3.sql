
-- Workplans (hierarchical assignment)
CREATE TABLE public.workplans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cycle_id uuid REFERENCES public.appraisal_cycles(id) ON DELETE SET NULL,
  period text NOT NULL,
  strategic_objective text NOT NULL,
  activity text NOT NULL,
  kpi text NOT NULL,
  target_value text NOT NULL,
  timeline text,
  weight numeric(5,2) DEFAULT 0,
  expected_deliverable text,
  status text NOT NULL DEFAULT 'assigned',
  pulled_into_appraisal_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workplans TO authenticated;
GRANT ALL ON public.workplans TO service_role;
ALTER TABLE public.workplans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wp_select_own_or_assigner_or_admin" ON public.workplans FOR SELECT TO authenticated
USING (
  assignee_id = auth.uid()
  OR assigned_by = auth.uid()
  OR public.is_admin_viewer(auth.uid())
  OR public.has_role(auth.uid(),'governor')
  OR public.has_role(auth.uid(),'cec')
  OR public.has_role(auth.uid(),'chief_officer')
  OR public.has_role(auth.uid(),'director')
  OR public.has_role(auth.uid(),'supervisor')
);
CREATE POLICY "wp_insert_by_assigner" ON public.workplans FOR INSERT TO authenticated
WITH CHECK (
  assigned_by = auth.uid()
  AND (
    public.has_role(auth.uid(),'supervisor')
    OR public.has_role(auth.uid(),'director')
    OR public.has_role(auth.uid(),'chief_officer')
    OR public.has_role(auth.uid(),'cec')
    OR public.has_role(auth.uid(),'governor')
    OR public.is_admin_viewer(auth.uid())
  )
);
CREATE POLICY "wp_update_assigner_or_admin" ON public.workplans FOR UPDATE TO authenticated
USING (assigned_by = auth.uid() OR public.is_admin_viewer(auth.uid()))
WITH CHECK (assigned_by = auth.uid() OR public.is_admin_viewer(auth.uid()));
CREATE POLICY "wp_delete_assigner_or_admin" ON public.workplans FOR DELETE TO authenticated
USING (assigned_by = auth.uid() OR public.is_admin_viewer(auth.uid()));

CREATE TRIGGER trg_workplans_touch BEFORE UPDATE ON public.workplans
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Continuous performance review updates
CREATE TABLE public.continuous_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  appraisal_id uuid REFERENCES public.appraisals(id) ON DELETE SET NULL,
  target_id uuid REFERENCES public.targets(id) ON DELETE SET NULL,
  workplan_id uuid REFERENCES public.workplans(id) ON DELETE SET NULL,
  achievement text NOT NULL,
  progress_status text NOT NULL DEFAULT 'in_progress',
  progress_comment text,
  challenges text,
  mitigation text,
  evidence_path text,
  evidence_filename text,
  evidence_mime text,
  supervisor_comment text,
  supervisor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  supervisor_commented_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.continuous_reviews TO authenticated;
GRANT ALL ON public.continuous_reviews TO service_role;
ALTER TABLE public.continuous_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cr_select_own_or_supervisor_or_admin" ON public.continuous_reviews FOR SELECT TO authenticated
USING (
  employee_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.appraisals a WHERE a.id = continuous_reviews.appraisal_id AND a.chosen_supervisor_id = auth.uid())
  OR public.is_admin_viewer(auth.uid())
  OR public.has_role(auth.uid(),'director')
  OR public.has_role(auth.uid(),'chief_officer')
);
CREATE POLICY "cr_insert_own" ON public.continuous_reviews FOR INSERT TO authenticated
WITH CHECK (employee_id = auth.uid());
CREATE POLICY "cr_update_own_or_supervisor" ON public.continuous_reviews FOR UPDATE TO authenticated
USING (
  employee_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.appraisals a WHERE a.id = continuous_reviews.appraisal_id AND a.chosen_supervisor_id = auth.uid())
  OR public.is_admin_viewer(auth.uid())
)
WITH CHECK (
  employee_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.appraisals a WHERE a.id = continuous_reviews.appraisal_id AND a.chosen_supervisor_id = auth.uid())
  OR public.is_admin_viewer(auth.uid())
);
CREATE POLICY "cr_delete_own" ON public.continuous_reviews FOR DELETE TO authenticated
USING (employee_id = auth.uid() OR public.is_admin_viewer(auth.uid()));

CREATE TRIGGER trg_continuous_reviews_touch BEFORE UPDATE ON public.continuous_reviews
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Storage policies for continuous-review-evidence bucket
CREATE POLICY "cre_select_own" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'continuous-review-evidence' AND (auth.uid()::text = (storage.foldername(name))[1] OR public.is_admin_viewer(auth.uid())));
CREATE POLICY "cre_insert_own" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'continuous-review-evidence' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "cre_update_own" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'continuous-review-evidence' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "cre_delete_own" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'continuous-review-evidence' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Self-appraisal structured reflections on appraisals
ALTER TABLE public.appraisals
  ADD COLUMN IF NOT EXISTS self_resources_needed text,
  ADD COLUMN IF NOT EXISTS self_challenges text,
  ADD COLUMN IF NOT EXISTS self_recommendations text,
  ADD COLUMN IF NOT EXISTS self_training_needs text,
  ADD COLUMN IF NOT EXISTS self_additional_comments text,
  ADD COLUMN IF NOT EXISTS supervisor_final_recommendation text;

-- Top performers RPC for director analytics
CREATE OR REPLACE FUNCTION public.top_performers_for_role(_uid uuid, _cycle_id uuid DEFAULT NULL, _limit int DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_county boolean; is_co boolean; is_director boolean;
  my_dept text; my_dir text;
  result jsonb;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid
    AND role IN ('governor','cec','system_admin','super_admin','hr')) INTO is_county;
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
