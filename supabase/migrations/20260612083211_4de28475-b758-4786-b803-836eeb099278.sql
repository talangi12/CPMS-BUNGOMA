
-- ============ Quarterly target progress ============
CREATE TABLE public.target_quarter_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id uuid NOT NULL REFERENCES public.targets(id) ON DELETE CASCADE,
  appraisal_id uuid NOT NULL REFERENCES public.appraisals(id) ON DELETE CASCADE,
  quarter smallint NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  progress_note text,
  achieved_value text,
  self_score numeric,
  supervisor_score numeric,
  supervisor_comment text,
  evidence_url text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_id, quarter)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.target_quarter_progress TO authenticated;
GRANT ALL ON public.target_quarter_progress TO service_role;

ALTER TABLE public.target_quarter_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tqp_owner_rw" ON public.target_quarter_progress
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.appraisals a
            WHERE a.id = target_quarter_progress.appraisal_id
              AND (a.employee_id = auth.uid()
                   OR a.chosen_supervisor_id = auth.uid()
                   OR public.is_admin_viewer(auth.uid())))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.appraisals a
            WHERE a.id = target_quarter_progress.appraisal_id
              AND (a.employee_id = auth.uid()
                   OR a.chosen_supervisor_id = auth.uid()))
  );

CREATE TRIGGER trg_tqp_touch
  BEFORE UPDATE ON public.target_quarter_progress
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX idx_tqp_appraisal ON public.target_quarter_progress(appraisal_id);
CREATE INDEX idx_tqp_target ON public.target_quarter_progress(target_id);

-- ============ Login events ============
CREATE TABLE public.login_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  id_number text,
  email text,
  ip_address text,
  user_agent text,
  success boolean NOT NULL,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.login_events TO authenticated;
GRANT ALL ON public.login_events TO service_role;
GRANT INSERT ON public.login_events TO anon;

ALTER TABLE public.login_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "login_events_insert_any" ON public.login_events
  FOR INSERT TO authenticated, anon
  WITH CHECK (true);

CREATE POLICY "login_events_admin_read" ON public.login_events
  FOR SELECT TO authenticated
  USING (public.is_admin_viewer(auth.uid()));

CREATE INDEX idx_login_events_created ON public.login_events(created_at DESC);
CREATE INDEX idx_login_events_user ON public.login_events(user_id);

-- ============ Helper: can_sign_as_supervisor ============
CREATE OR REPLACE FUNCTION public.can_sign_as_supervisor(_actor uuid, _employee uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  emp_dept text; emp_dir text;
  actor_dept text; actor_dir text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.appraisals
             WHERE employee_id = _employee AND chosen_supervisor_id = _actor) THEN
    RETURN true;
  END IF;
  SELECT department, directorate INTO emp_dept, emp_dir
    FROM public.profiles WHERE id = _employee;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _actor AND role = 'director') THEN
    SELECT department, directorate INTO actor_dept, actor_dir
      FROM public.profiles WHERE id = _actor;
    IF lower(coalesce(actor_dept,'')) = lower(coalesce(emp_dept,''))
       AND lower(coalesce(actor_dir,'')) = lower(coalesce(emp_dir,'')) THEN
      RETURN true;
    END IF;
  END IF;
  RETURN false;
END $$;

-- ============ Helper: current_quarter ============
CREATE OR REPLACE FUNCTION public.current_quarter(_fy_start date)
RETURNS smallint
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _fy_start IS NULL THEN NULL
    WHEN now() < _fy_start THEN NULL
    WHEN now() < _fy_start + interval '3 months' THEN 1::smallint
    WHEN now() < _fy_start + interval '6 months' THEN 2::smallint
    WHEN now() < _fy_start + interval '9 months' THEN 3::smallint
    WHEN now() < _fy_start + interval '12 months' THEN 4::smallint
    ELSE 4::smallint
  END
$$;
