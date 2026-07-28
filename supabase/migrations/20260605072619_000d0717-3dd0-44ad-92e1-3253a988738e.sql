
-- Roles enum + table
CREATE TYPE public.app_role AS ENUM ('employee','supervisor','department_head','hr_officer','cpmc','board','chief_officer','county_administrator','admin','super_admin');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- Profiles
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_no text UNIQUE,
  national_id text,
  full_name text NOT NULL,
  email text,
  phone text,
  designation text,
  job_group text,
  department text,
  directorate text,
  work_station text,
  supervisor_id uuid REFERENCES public.profiles(id),
  employment_status text DEFAULT 'active',
  employment_date date,
  photo_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- Appraisals
CREATE TABLE public.appraisals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  period text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  total_score numeric(5,2),
  rating text,
  employee_comments text,
  supervisor_comments text,
  recommendation text,
  employee_signed_at timestamptz,
  supervisor_signed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appraisals TO authenticated;
GRANT ALL ON public.appraisals TO service_role;
ALTER TABLE public.appraisals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Employees manage own appraisals" ON public.appraisals FOR ALL TO authenticated USING (auth.uid() = employee_id) WITH CHECK (auth.uid() = employee_id);

-- Targets
CREATE TABLE public.targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appraisal_id uuid NOT NULL REFERENCES public.appraisals(id) ON DELETE CASCADE,
  target text NOT NULL,
  indicator text,
  weight numeric(5,2) NOT NULL DEFAULT 0,
  expected_outcome text,
  achieved_result text,
  score numeric(5,2),
  evidence_url text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.targets TO authenticated;
GRANT ALL ON public.targets TO service_role;
ALTER TABLE public.targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Manage targets of own appraisals" ON public.targets FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.appraisals a WHERE a.id = appraisal_id AND a.employee_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.appraisals a WHERE a.id = appraisal_id AND a.employee_id = auth.uid()));

-- Auto-update timestamps
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_appraisals_updated BEFORE UPDATE ON public.appraisals FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Auto-create profile + employee role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Performance rating helper
CREATE OR REPLACE FUNCTION public.classify_rating(pct numeric) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN pct >= 101 THEN 'Excellent'
    WHEN pct >= 85  THEN 'Very Good'
    WHEN pct >= 65  THEN 'Good'
    WHEN pct >= 50  THEN 'Fair'
    ELSE 'Poor'
  END
$$;
