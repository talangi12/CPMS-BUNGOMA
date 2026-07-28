
-- Phase 1: Hierarchical bulk import + ID-Number/Personal-Number login

-- 1) Extend app_role with 'cec' if missing
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'app_role'::regtype AND enumlabel = 'cec') THEN
    ALTER TYPE app_role ADD VALUE 'cec';
  END IF;
END $$;

-- 2) Profile fields for import/identity
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS id_number text,
  ADD COLUMN IF NOT EXISTS personal_number text,
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS disability_status text,
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS imported_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS imported_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_id_number_uidx ON public.profiles(id_number) WHERE id_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS profiles_personal_number_idx ON public.profiles(personal_number) WHERE personal_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS profiles_dept_idx ON public.profiles(department);
CREATE INDEX IF NOT EXISTS profiles_directorate_idx ON public.profiles(directorate);
CREATE INDEX IF NOT EXISTS profiles_supervisor_idx ON public.profiles(supervisor_id);

-- 3) Helper — get caller's primary department from a role row
CREATE OR REPLACE FUNCTION public.user_role_dept(_uid uuid, _role app_role)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT department FROM public.user_roles WHERE user_id=_uid AND role=_role LIMIT 1
$$;

-- 4) Hierarchical import authorization
-- system_admin / super_admin: any role anywhere
-- governor: cec only
-- cec: chief_officer in same department
-- chief_officer: director in same department
-- director: employee + supervisor in same directorate
CREATE OR REPLACE FUNCTION public.can_import(_actor uuid, _target_role app_role, _dept text, _directorate text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE
  is_sys boolean;
  actor_dept text;
  actor_dir text;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role IN ('system_admin','super_admin'))
    INTO is_sys;
  IF is_sys THEN RETURN true; END IF;

  -- Governor → CEC (any dept)
  IF _target_role = 'cec' THEN
    RETURN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role='governor');
  END IF;

  -- CEC → Chief Officer (same dept)
  IF _target_role = 'chief_officer' THEN
    actor_dept := public.user_role_dept(_actor,'cec');
    RETURN actor_dept IS NOT NULL AND lower(actor_dept) = lower(coalesce(_dept,''));
  END IF;

  -- Chief Officer → Director (same dept)
  IF _target_role = 'director' THEN
    actor_dept := public.user_role_dept(_actor,'chief_officer');
    RETURN actor_dept IS NOT NULL AND lower(actor_dept) = lower(coalesce(_dept,''));
  END IF;

  -- Director → Employee (same directorate, same dept)
  IF _target_role IN ('employee','supervisor') THEN
    SELECT department, directorate INTO actor_dept, actor_dir
      FROM public.profiles WHERE id=_actor;
    -- If actor has director role with a dept, use that dept; else profile dept
    IF EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role='director') THEN
      RETURN lower(coalesce(actor_dept,''))=lower(coalesce(_dept,''))
         AND (actor_dir IS NULL OR lower(actor_dir)=lower(coalesce(_directorate,'')));
    END IF;
  END IF;

  RETURN false;
END $$;

GRANT EXECUTE ON FUNCTION public.can_import(uuid, app_role, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_role_dept(uuid, app_role) TO authenticated;

-- 5) Search scope helper — returns true if actor may view target
CREATE OR REPLACE FUNCTION public.can_view_profile(_actor uuid, _target uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE
  is_sys boolean; t record; actor_dept text; actor_dir text;
BEGIN
  IF _actor = _target THEN RETURN true; END IF;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role IN ('system_admin','super_admin','hr'))
    INTO is_sys;
  IF is_sys THEN RETURN true; END IF;

  SELECT department, directorate, supervisor_id INTO t FROM public.profiles WHERE id=_target;
  IF NOT FOUND THEN RETURN false; END IF;

  -- Governor sees all
  IF EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role='governor') THEN
    RETURN true;
  END IF;

  -- CEC: same dept
  actor_dept := public.user_role_dept(_actor,'cec');
  IF actor_dept IS NOT NULL AND lower(actor_dept)=lower(coalesce(t.department,'')) THEN RETURN true; END IF;

  -- Chief Officer: same dept
  actor_dept := public.user_role_dept(_actor,'chief_officer');
  IF actor_dept IS NOT NULL AND lower(actor_dept)=lower(coalesce(t.department,'')) THEN RETURN true; END IF;

  -- Director: same directorate
  IF EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role='director') THEN
    SELECT department, directorate INTO actor_dept, actor_dir FROM public.profiles WHERE id=_actor;
    IF lower(coalesce(actor_dept,''))=lower(coalesce(t.department,''))
       AND lower(coalesce(actor_dir,''))=lower(coalesce(t.directorate,'')) THEN RETURN true; END IF;
  END IF;

  -- Supervisor: directly assigned
  IF EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role='supervisor')
     AND t.supervisor_id = _actor THEN RETURN true; END IF;

  RETURN false;
END $$;

GRANT EXECUTE ON FUNCTION public.can_view_profile(uuid, uuid) TO authenticated;

-- 6) Update handle_new_user: seed super admin for ID-number account
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
BEGIN
  INSERT INTO public.profiles (id, full_name, email, employee_no, designation, department, id_number, personal_number, directorate, work_station, job_group, gender, disability_status, must_change_password, imported_by, imported_at)
  VALUES (
    NEW.id,
    COALESCE(meta->>'full_name', split_part(NEW.email,'@',1)),
    NEW.email,
    COALESCE(meta->>'employee_no', meta->>'id_number', 'BGM-' || substr(NEW.id::text,1,6)),
    COALESCE(meta->>'designation', 'Officer'),
    COALESCE(meta->>'department', 'Administration'),
    meta->>'id_number',
    meta->>'personal_number',
    meta->>'directorate',
    meta->>'workstation',
    meta->>'job_group',
    meta->>'gender',
    meta->>'disability_status',
    COALESCE((meta->>'must_change_password')::boolean, false),
    NULLIF(meta->>'imported_by','')::uuid,
    CASE WHEN meta ? 'imported_by' THEN now() ELSE NULL END
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'employee') ON CONFLICT DO NOTHING;

  -- Default super admin: ID 010203045
  IF meta->>'id_number' = '010203045' OR lower(NEW.email) = '010203045@epms.bungoma.local' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'super_admin') ON CONFLICT DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'system_admin') ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END $$;

-- 7) Revoke privileges from old email super admins per user direction
DELETE FROM public.user_roles
WHERE role IN ('super_admin','system_admin')
  AND user_id IN (SELECT id FROM auth.users WHERE lower(email) IN ('super@bungoma.go.ke','super26@bungoma.go.ke'));
