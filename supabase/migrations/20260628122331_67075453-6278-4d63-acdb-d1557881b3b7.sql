
-- Notification channel preference
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notify_channel text NOT NULL DEFAULT 'both'
    CHECK (notify_channel IN ('email','sms','both','dashboard'));

-- Structured self-appraisal responses
ALTER TABLE public.appraisals
  ADD COLUMN IF NOT EXISTS self_resources_needed text,
  ADD COLUMN IF NOT EXISTS self_challenges       text,
  ADD COLUMN IF NOT EXISTS self_achievements     text,
  ADD COLUMN IF NOT EXISTS self_lessons          text,
  ADD COLUMN IF NOT EXISTS self_recommendations  text,
  ADD COLUMN IF NOT EXISTS self_training_needs   text,
  ADD COLUMN IF NOT EXISTS self_additional       text;

-- Prevent duplicate IDs / payroll numbers (allow nulls)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_id_number_unique
  ON public.profiles (id_number) WHERE id_number IS NOT NULL AND id_number <> '';
CREATE UNIQUE INDEX IF NOT EXISTS profiles_personal_number_unique
  ON public.profiles (personal_number) WHERE personal_number IS NOT NULL AND personal_number <> '';
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique
  ON public.profiles (lower(email)) WHERE email IS NOT NULL AND email <> '';

-- Department-scoped supervisor lookup for appraisee picker
CREATE OR REPLACE FUNCTION public.list_supervisors_for_dept(_dept text)
RETURNS TABLE(id uuid, full_name text, designation text, department text, directorate text, photo_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.full_name, p.designation, p.department, p.directorate, p.photo_url
  FROM public.profiles p
  JOIN public.user_roles r ON r.user_id = p.id
  WHERE r.role = 'supervisor'
    AND (_dept IS NULL OR _dept = '' OR lower(p.department) = lower(_dept))
    AND COALESCE(p.employee_status::text,'active') = 'active'
  ORDER BY p.full_name
$$;
GRANT EXECUTE ON FUNCTION public.list_supervisors_for_dept(text) TO authenticated;
