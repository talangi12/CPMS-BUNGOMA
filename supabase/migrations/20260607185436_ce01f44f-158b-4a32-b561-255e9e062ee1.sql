
-- 2. Extend appraisals + targets
ALTER TABLE public.appraisals
  ADD COLUMN IF NOT EXISTS chosen_supervisor_id uuid,
  ADD COLUMN IF NOT EXISTS supervisor_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

ALTER TABLE public.targets
  ADD COLUMN IF NOT EXISTS supervisor_review text;

-- 3. Helper: list available supervisors (anyone authenticated may read this minimal projection)
CREATE OR REPLACE FUNCTION public.list_supervisors()
RETURNS TABLE (id uuid, full_name text, designation text, department text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.full_name, p.designation, p.department
  FROM public.profiles p
  JOIN public.user_roles r ON r.user_id = p.id
  WHERE r.role = 'supervisor'
  ORDER BY p.full_name
$$;

GRANT EXECUTE ON FUNCTION public.list_supervisors() TO authenticated;

-- 4. Admin-visibility helper: any of HR/system_admin/super_admin
CREATE OR REPLACE FUNCTION public.is_admin_viewer(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid AND role IN ('hr','system_admin','super_admin')
  )
$$;

GRANT EXECUTE ON FUNCTION public.is_admin_viewer(uuid) TO authenticated;

-- 5. RLS: supervisor & admin access on appraisals
DROP POLICY IF EXISTS "Supervisor views assigned appraisals" ON public.appraisals;
CREATE POLICY "Supervisor views assigned appraisals" ON public.appraisals
  FOR SELECT TO authenticated
  USING (chosen_supervisor_id = auth.uid() OR public.is_admin_viewer(auth.uid()));

DROP POLICY IF EXISTS "Supervisor updates assigned appraisals" ON public.appraisals;
CREATE POLICY "Supervisor updates assigned appraisals" ON public.appraisals
  FOR UPDATE TO authenticated
  USING (chosen_supervisor_id = auth.uid())
  WITH CHECK (chosen_supervisor_id = auth.uid());

-- Profiles: supervisors/admins need to read appraisee profile when reviewing
DROP POLICY IF EXISTS "Supervisor and admins view related profiles" ON public.profiles;
CREATE POLICY "Supervisor and admins view related profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    public.is_admin_viewer(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.appraisals a
      WHERE a.employee_id = profiles.id AND a.chosen_supervisor_id = auth.uid()
    )
  );

-- Targets: supervisor can view/update for assigned appraisals; admins can view
DROP POLICY IF EXISTS "Supervisor manages targets of assigned appraisals" ON public.targets;
CREATE POLICY "Supervisor manages targets of assigned appraisals" ON public.targets
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.appraisals a
    WHERE a.id = targets.appraisal_id
      AND (a.chosen_supervisor_id = auth.uid() OR public.is_admin_viewer(auth.uid()))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.appraisals a
    WHERE a.id = targets.appraisal_id AND a.chosen_supervisor_id = auth.uid()
  ));

-- 6. Notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  related_appraisal_id uuid,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own notifications" ON public.notifications;
CREATE POLICY "Users see own notifications" ON public.notifications
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own notifications" ON public.notifications;
CREATE POLICY "Users update own notifications" ON public.notifications
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON public.notifications (user_id, read_at, created_at DESC);

-- 7. Trigger: notify on submit / approve / reject
CREATE OR REPLACE FUNCTION public.notify_appraisal_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  emp_name text;
BEGIN
  SELECT full_name INTO emp_name FROM public.profiles WHERE id = NEW.employee_id;

  IF NEW.status = 'submitted' AND (OLD.status IS DISTINCT FROM 'submitted')
     AND NEW.chosen_supervisor_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link, related_appraisal_id)
    VALUES (NEW.chosen_supervisor_id, 'appraisal_submitted',
            'New appraisal to review',
            COALESCE(emp_name,'An employee') || ' submitted their ' || NEW.period || ' appraisal for your review.',
            '/supervisor/review/' || NEW.id::text,
            NEW.id);
  END IF;

  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    INSERT INTO public.notifications (user_id, type, title, body, link, related_appraisal_id)
    VALUES (NEW.employee_id, 'appraisal_approved',
            'Targets approved',
            'Your ' || NEW.period || ' performance targets have been approved.',
            '/appraisal', NEW.id);
  END IF;

  IF NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected' THEN
    INSERT INTO public.notifications (user_id, type, title, body, link, related_appraisal_id)
    VALUES (NEW.employee_id, 'appraisal_rejected',
            'Targets need revision',
            COALESCE('Supervisor comments: ' || NEW.rejection_reason, 'Your supervisor requested changes to your targets.'),
            '/appraisal', NEW.id);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS appraisal_status_notify ON public.appraisals;
CREATE TRIGGER appraisal_status_notify
  AFTER UPDATE OF status ON public.appraisals
  FOR EACH ROW EXECUTE FUNCTION public.notify_appraisal_status();

-- 8. Allow viewers (HR/admin) to see all user_roles for admin screens
DROP POLICY IF EXISTS "Admin viewers see all roles" ON public.user_roles;
CREATE POLICY "Admin viewers see all roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (public.is_admin_viewer(auth.uid()));
