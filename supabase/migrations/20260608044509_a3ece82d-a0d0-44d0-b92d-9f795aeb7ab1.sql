
-- 1) Appraisals: FY start (defaults to July 1 of current FY) + midyear + PDF fields
ALTER TABLE public.appraisals
  ADD COLUMN IF NOT EXISTS fy_start date,
  ADD COLUMN IF NOT EXISTS midyear_unlocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS midyear_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS pdf_path text,
  ADD COLUMN IF NOT EXISTS pdf_generated_at timestamptz;

-- Backfill fy_start for existing rows: assume Kenyan FY July-June
UPDATE public.appraisals
SET fy_start = CASE
  WHEN extract(month from created_at) >= 7
    THEN make_date(extract(year from created_at)::int, 7, 1)
  ELSE make_date(extract(year from created_at)::int - 1, 7, 1)
END
WHERE fy_start IS NULL;

-- 2) Targets: mid-year fields
ALTER TABLE public.targets
  ADD COLUMN IF NOT EXISTS midyear_progress text,
  ADD COLUMN IF NOT EXISTS midyear_score numeric,
  ADD COLUMN IF NOT EXISTS midyear_supervisor_comment text;

-- 3) Helper: is the midyear unlocked for a given appraisal row?
CREATE OR REPLACE FUNCTION public.midyear_unlocked(_appraisal_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.appraisals a
    WHERE a.id = _appraisal_id
      AND a.status IN ('approved','midyear','completed')
      AND a.fy_start IS NOT NULL
      AND now() >= (a.fy_start + interval '6 months')
  )
$$;

-- 4) Auto-unlock midyear when supervisor approves (and FY half passed)
CREATE OR REPLACE FUNCTION public.try_unlock_midyear()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    IF NEW.fy_start IS NOT NULL AND now() >= (NEW.fy_start + interval '6 months')
       AND NEW.midyear_unlocked_at IS NULL THEN
      NEW.midyear_unlocked_at := now();
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_try_unlock_midyear ON public.appraisals;
CREATE TRIGGER trg_try_unlock_midyear
  BEFORE UPDATE ON public.appraisals
  FOR EACH ROW EXECUTE FUNCTION public.try_unlock_midyear();

-- 5) Appeals table
CREATE TABLE IF NOT EXISTS public.appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appraisal_id uuid NOT NULL,
  appellant_id uuid NOT NULL,
  grounds text NOT NULL,
  desired_outcome text,
  status text NOT NULL DEFAULT 'submitted',  -- submitted | under_review | upheld | overturned | revised | dismissed
  committee_comments text,
  ruling text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.appeals TO authenticated;
GRANT ALL ON public.appeals TO service_role;

ALTER TABLE public.appeals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Appellants manage own appeals"
  ON public.appeals FOR ALL TO authenticated
  USING (appellant_id = auth.uid())
  WITH CHECK (appellant_id = auth.uid());

CREATE POLICY "Committee and admins view all appeals"
  ON public.appeals FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'appeals_committee') OR is_admin_viewer(auth.uid()));

CREATE POLICY "Committee rules on appeals"
  ON public.appeals FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'appeals_committee') OR has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'appeals_committee') OR has_role(auth.uid(), 'super_admin'));

CREATE TRIGGER trg_appeals_touch
  BEFORE UPDATE ON public.appeals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 6) Appeal notification trigger
CREATE OR REPLACE FUNCTION public.notify_appeal_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  committee_user uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- notify all committee members
    FOR committee_user IN SELECT user_id FROM public.user_roles WHERE role = 'appeals_committee' LOOP
      INSERT INTO public.notifications(user_id, type, title, body, link, related_appraisal_id)
      VALUES (committee_user, 'appeal_submitted',
              'New appeal filed',
              'An employee has filed an appeal awaiting committee review.',
              '/committee/appeals',
              NEW.appraisal_id);
    END LOOP;
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status
        AND NEW.status IN ('upheld','overturned','revised','dismissed') THEN
    INSERT INTO public.notifications(user_id, type, title, body, link, related_appraisal_id)
    VALUES (NEW.appellant_id, 'appeal_ruled',
            'Appeal ruling issued',
            'The Appeals Committee has issued a ruling on your appeal: ' || NEW.status || '.',
            '/appeals',
            NEW.appraisal_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_appeal ON public.appeals;
CREATE TRIGGER trg_notify_appeal
  AFTER INSERT OR UPDATE ON public.appeals
  FOR EACH ROW EXECUTE FUNCTION public.notify_appeal_status();

-- 7) List supervisors helper (re-grant for safety)
GRANT EXECUTE ON FUNCTION public.midyear_unlocked(uuid) TO authenticated;
