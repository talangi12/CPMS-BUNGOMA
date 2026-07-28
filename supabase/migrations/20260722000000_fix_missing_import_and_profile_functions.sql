-- Fix missing import/profile/admin helper functions for bulk import and related features

-- Ensure app_role enum contains common values used by import and access logic
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.app_role'::regtype AND enumlabel = 'cec') THEN
    ALTER TYPE public.app_role ADD VALUE 'cec';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.app_role'::regtype AND enumlabel = 'dept_admin') THEN
    ALTER TYPE public.app_role ADD VALUE 'dept_admin';
  END IF;
END $$;

-- Recreate user_role_dept helper
CREATE OR REPLACE FUNCTION public.user_role_dept(_uid uuid, _role public.app_role)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT department
  FROM public.user_roles
  WHERE user_id = _uid AND role = _role
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.user_role_dept(uuid, public.app_role) TO authenticated;

-- Recreate admin-view helper with broader admin coverage
CREATE OR REPLACE FUNCTION public.is_admin_viewer(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _uid
      AND role IN ('hr','system_admin','super_admin','governor','cec','chief_officer','director','dept_admin','admin','county_administrator','department_head')
  )
$$;

GRANT EXECUTE ON FUNCTION public.is_admin_viewer(uuid) TO authenticated;

-- Recreate bulk import authorization helper with a signature matching the app
CREATE OR REPLACE FUNCTION public.can_import(_actor uuid, _target_role public.app_role, _dept text, _directorate text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_sys boolean;
  actor_dept text;
  actor_dir text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _actor AND role IN ('system_admin','super_admin','hr')
  ) INTO is_sys;
  IF is_sys THEN
    RETURN true;
  END IF;

  IF _target_role = 'cec' THEN
    RETURN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _actor AND role = 'governor');
  END IF;

  IF _target_role = 'chief_officer' THEN
    actor_dept := public.user_role_dept(_actor, 'cec'::public.app_role);
    RETURN actor_dept IS NOT NULL AND lower(actor_dept) = lower(coalesce(_dept, ''));
  END IF;

  IF _target_role = 'director' THEN
    actor_dept := public.user_role_dept(_actor, 'chief_officer'::public.app_role);
    RETURN actor_dept IS NOT NULL AND lower(actor_dept) = lower(coalesce(_dept, ''));
  END IF;

  IF _target_role IN ('employee','supervisor') THEN
    SELECT department, directorate INTO actor_dept, actor_dir
    FROM public.profiles
    WHERE id = _actor;

    IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _actor AND role = 'director') THEN
      RETURN lower(coalesce(actor_dept, '')) = lower(coalesce(_dept, ''))
        AND (actor_dir IS NULL OR lower(actor_dir) = lower(coalesce(_directorate, '')));
    END IF;
  END IF;

  RETURN false;
END
$$;

GRANT EXECUTE ON FUNCTION public.can_import(uuid, public.app_role, text, text) TO authenticated;

-- Recreate profile visibility helper
CREATE OR REPLACE FUNCTION public.can_view_profile(_actor uuid, _target uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_sys boolean;
  t record;
  actor_dept text;
  actor_dir text;
BEGIN
  IF _actor = _target THEN
    RETURN true;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _actor AND role IN ('system_admin','super_admin','hr')
  ) INTO is_sys;
  IF is_sys THEN
    RETURN true;
  END IF;

  SELECT department, directorate, supervisor_id INTO t
  FROM public.profiles
  WHERE id = _target;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _actor AND role = 'governor') THEN
    RETURN true;
  END IF;

  actor_dept := public.user_role_dept(_actor, 'cec'::public.app_role);
  IF actor_dept IS NOT NULL AND lower(actor_dept) = lower(coalesce(t.department, '')) THEN
    RETURN true;
  END IF;

  actor_dept := public.user_role_dept(_actor, 'chief_officer'::public.app_role);
  IF actor_dept IS NOT NULL AND lower(actor_dept) = lower(coalesce(t.department, '')) THEN
    RETURN true;
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _actor AND role = 'director') THEN
    SELECT department, directorate INTO actor_dept, actor_dir FROM public.profiles WHERE id = _actor;
    IF lower(coalesce(actor_dept, '')) = lower(coalesce(t.department, ''))
       AND lower(coalesce(actor_dir, '')) = lower(coalesce(t.directorate, '')) THEN
      RETURN true;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _actor AND role = 'supervisor')
     AND t.supervisor_id = _actor THEN
    RETURN true;
  END IF;

  RETURN false;
END
$$;

GRANT EXECUTE ON FUNCTION public.can_view_profile(uuid, uuid) TO authenticated;

-- Recreate supervisor-signing helper used by sign-off flows
CREATE OR REPLACE FUNCTION public.can_sign_as_supervisor(_actor uuid, _employee uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _actor AND ur.role IN ('supervisor','director','chief_officer','cec','governor','system_admin','super_admin','hr')
  )
$$;

GRANT EXECUTE ON FUNCTION public.can_sign_as_supervisor(uuid, uuid) TO authenticated;

-- Recreate contract-start helper used by contract management
CREATE OR REPLACE FUNCTION public.can_start_contract(_owner uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid() AND role IN ('system_admin','super_admin','hr','director','chief_officer','cec','governor')
  )
$$;

GRANT EXECUTE ON FUNCTION public.can_start_contract(uuid) TO authenticated;

-- Ensure the app has the columns used by import/profile features
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS id_number text,
  ADD COLUMN IF NOT EXISTS personal_number text,
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS disability_status text,
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS imported_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS imported_at timestamptz,
  ADD COLUMN IF NOT EXISTS personal_email text,
  ADD COLUMN IF NOT EXISTS phone_number text,
  ADD COLUMN IF NOT EXISTS directorate text,
  ADD COLUMN IF NOT EXISTS work_station text,
  ADD COLUMN IF NOT EXISTS job_group text,
  ADD COLUMN IF NOT EXISTS employee_status text;

ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS department text;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_id_number_uidx ON public.profiles(id_number) WHERE id_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS profiles_personal_number_idx ON public.profiles(personal_number) WHERE personal_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS profiles_department_idx ON public.profiles(department);
CREATE INDEX IF NOT EXISTS profiles_directorate_idx ON public.profiles(directorate);

-- Best-effort seed for the default admin profile if it exists
DO $$
DECLARE
  admin_id uuid;
BEGIN
  SELECT id INTO admin_id FROM public.profiles WHERE id_number = '010203045' LIMIT 1;
  IF admin_id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role, department) VALUES (admin_id, 'employee', NULL) ON CONFLICT DO NOTHING;
    INSERT INTO public.user_roles (user_id, role, department) VALUES (admin_id, 'system_admin', NULL) ON CONFLICT DO NOTHING;
    INSERT INTO public.user_roles (user_id, role, department) VALUES (admin_id, 'super_admin', NULL) ON CONFLICT DO NOTHING;
  END IF;
END $$;
