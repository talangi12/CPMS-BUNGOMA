
-- 1. End-year + self-statements + signature chain
ALTER TABLE public.appraisals
  ADD COLUMN IF NOT EXISTS endyear_unlocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS endyear_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS self_commitments text,
  ADD COLUMN IF NOT EXISTS self_overall_comment text,
  ADD COLUMN IF NOT EXISTS cycle_signoffs jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.targets
  ADD COLUMN IF NOT EXISTS endyear_actual text,
  ADD COLUMN IF NOT EXISTS endyear_self_score numeric,
  ADD COLUMN IF NOT EXISTS endyear_supervisor_score numeric,
  ADD COLUMN IF NOT EXISTS endyear_self_comment text,
  ADD COLUMN IF NOT EXISTS endyear_supervisor_comment text;

ALTER TABLE public.appeals
  ADD COLUMN IF NOT EXISTS evidence_paths text[] NOT NULL DEFAULT '{}'::text[];

-- 2. End-year auto-unlock trigger (12 months after fy_start)
CREATE OR REPLACE FUNCTION public.try_unlock_endyear()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.fy_start IS NOT NULL AND now() >= (NEW.fy_start + interval '12 months')
     AND NEW.endyear_unlocked_at IS NULL
     AND NEW.status IN ('approved','midyear') THEN
    NEW.endyear_unlocked_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_try_unlock_endyear ON public.appraisals;
CREATE TRIGGER trg_try_unlock_endyear
  BEFORE UPDATE ON public.appraisals
  FOR EACH ROW EXECUTE FUNCTION public.try_unlock_endyear();

CREATE OR REPLACE FUNCTION public.endyear_unlocked(_appraisal_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.appraisals a
    WHERE a.id = _appraisal_id
      AND a.fy_start IS NOT NULL
      AND now() >= (a.fy_start + interval '12 months')
  )
$$;
GRANT EXECUTE ON FUNCTION public.endyear_unlocked(uuid) TO authenticated;

-- 3. Seed super_admin on signup for designated bootstrap email
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, employee_no, designation, department)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'employee_no', 'BGM-' || substr(NEW.id::text,1,6)),
    COALESCE(NEW.raw_user_meta_data->>'designation', 'Officer'),
    COALESCE(NEW.raw_user_meta_data->>'department', 'Administration')
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'employee');
  -- Bootstrap super admin
  IF lower(NEW.email) = 'super@bungoma.go.ke' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'super_admin')
      ON CONFLICT DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'system_admin')
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

-- 4. If the super email already exists in auth.users, grant roles now (idempotent bootstrap)
DO $$
DECLARE su uuid;
BEGIN
  SELECT id INTO su FROM auth.users WHERE lower(email) = 'super@bungoma.go.ke' LIMIT 1;
  IF su IS NOT NULL THEN
    INSERT INTO public.user_roles(user_id, role) VALUES (su, 'super_admin') ON CONFLICT DO NOTHING;
    INSERT INTO public.user_roles(user_id, role) VALUES (su, 'system_admin') ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- 5. Storage policies: avatars (public bucket) + appeal-evidence (private)
-- Buckets created via tool calls separately. Define RLS now so they apply once buckets exist.

-- Avatars: anyone authenticated may read; users may write only to their own folder (uid prefix)
DROP POLICY IF EXISTS "avatars_read" ON storage.objects;
CREATE POLICY "avatars_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');
DROP POLICY IF EXISTS "avatars_owner_write" ON storage.objects;
CREATE POLICY "avatars_owner_write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "avatars_owner_update" ON storage.objects;
CREATE POLICY "avatars_owner_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "avatars_owner_delete" ON storage.objects;
CREATE POLICY "avatars_owner_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Appeal evidence: appellant + committee + admin viewer may read; appellant writes own folder
DROP POLICY IF EXISTS "appeal_evidence_read" ON storage.objects;
CREATE POLICY "appeal_evidence_read" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'appeal-evidence' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.has_role(auth.uid(), 'appeals_committee')
      OR public.is_admin_viewer(auth.uid())
    )
  );
DROP POLICY IF EXISTS "appeal_evidence_write" ON storage.objects;
CREATE POLICY "appeal_evidence_write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'appeal-evidence' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "appeal_evidence_delete" ON storage.objects;
CREATE POLICY "appeal_evidence_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'appeal-evidence' AND (storage.foldername(name))[1] = auth.uid()::text);
