
-- Trigger: auto-log key appraisal transitions into audit_logs
CREATE OR REPLACE FUNCTION public.audit_appraisal_changes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, new_values)
    VALUES (COALESCE(auth.uid(), NEW.employee_id), 'appraisal_created', 'appraisals', NEW.id::text,
      jsonb_build_object('period', NEW.period, 'status', NEW.status));
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, old_values, new_values)
    VALUES (auth.uid(), 'appraisal_status_changed', 'appraisals', NEW.id::text,
      jsonb_build_object('status', OLD.status),
      jsonb_build_object('status', NEW.status, 'reason', NEW.rejection_reason));
  END IF;

  IF NEW.employee_signed_at IS DISTINCT FROM OLD.employee_signed_at
     AND NEW.employee_signed_at IS NOT NULL THEN
    INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, new_values)
    VALUES (auth.uid(), 'employee_signed', 'appraisals', NEW.id::text,
      jsonb_build_object('at', NEW.employee_signed_at));
  END IF;

  IF NEW.supervisor_reviewed_at IS DISTINCT FROM OLD.supervisor_reviewed_at
     AND NEW.supervisor_reviewed_at IS NOT NULL THEN
    INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, new_values)
    VALUES (auth.uid(), 'supervisor_reviewed', 'appraisals', NEW.id::text,
      jsonb_build_object('at', NEW.supervisor_reviewed_at, 'status', NEW.status));
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_audit_appraisals ON public.appraisals;
CREATE TRIGGER trg_audit_appraisals
  AFTER INSERT OR UPDATE ON public.appraisals
  FOR EACH ROW EXECUTE FUNCTION public.audit_appraisal_changes();

-- RPC: authorised timeline for a single appraisal
CREATE OR REPLACE FUNCTION public.appraisal_timeline(_appraisal_id uuid)
RETURNS TABLE(
  id uuid,
  at timestamptz,
  actor_id uuid,
  actor_name text,
  actor_email text,
  action text,
  details jsonb
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _emp uuid;
  _sup uuid;
  _allowed boolean;
BEGIN
  SELECT a.employee_id, a.chosen_supervisor_id INTO _emp, _sup
  FROM public.appraisals a WHERE a.id = _appraisal_id;

  IF _emp IS NULL THEN
    RAISE EXCEPTION 'Appraisal not found';
  END IF;

  _allowed :=
    auth.uid() = _emp
    OR auth.uid() = _sup
    OR public.is_admin_viewer(auth.uid())
    OR public.can_sign_as_supervisor(auth.uid(), _emp);

  IF NOT _allowed THEN
    RAISE EXCEPTION 'Not authorised to view this timeline';
  END IF;

  RETURN QUERY
    SELECT
      l.id,
      l.created_at AS at,
      l.actor_id,
      COALESCE(p.full_name, l.actor_email) AS actor_name,
      l.actor_email,
      l.action,
      COALESCE(l.new_values, l.old_values) AS details
    FROM public.audit_logs l
    LEFT JOIN public.profiles p ON p.id = l.actor_id
    WHERE l.entity_type = 'appraisals'
      AND l.entity_id = _appraisal_id::text
    ORDER BY l.created_at ASC;
END $$;

GRANT EXECUTE ON FUNCTION public.appraisal_timeline(uuid) TO authenticated;
