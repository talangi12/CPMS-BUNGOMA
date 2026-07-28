
-- ORG UNITS
CREATE TABLE public.org_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  directorate text,
  department text NOT NULL,
  section text,
  unit text,
  employee_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (directorate, department, section, unit)
);
GRANT SELECT ON public.org_units TO authenticated;
GRANT ALL ON public.org_units TO service_role;
ALTER TABLE public.org_units ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated reads org units" ON public.org_units FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage org units" ON public.org_units FOR ALL TO authenticated USING (public.is_admin_viewer(auth.uid())) WITH CHECK (public.is_admin_viewer(auth.uid()));

-- SYNC LOGS
CREATE TABLE public.sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  status text NOT NULL,
  processed integer NOT NULL DEFAULT 0,
  created integer NOT NULL DEFAULT 0,
  updated integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  details jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX sync_logs_started_idx ON public.sync_logs(started_at DESC);
GRANT SELECT ON public.sync_logs TO authenticated;
GRANT ALL ON public.sync_logs TO service_role;
ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read sync logs" ON public.sync_logs FOR SELECT TO authenticated USING (public.is_admin_viewer(auth.uid()));

-- SYNC SCHEDULE (single-row preferences)
CREATE TABLE public.sync_schedule (
  id integer PRIMARY KEY DEFAULT 1,
  frequency text NOT NULL DEFAULT 'manual',
  endpoint_url text,
  last_run_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT one_row CHECK (id = 1),
  CONSTRAINT freq_valid CHECK (frequency IN ('manual','daily','weekly'))
);
INSERT INTO public.sync_schedule (id, frequency) VALUES (1, 'manual') ON CONFLICT DO NOTHING;
GRANT SELECT ON public.sync_schedule TO authenticated;
GRANT ALL ON public.sync_schedule TO service_role;
ALTER TABLE public.sync_schedule ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read sync schedule" ON public.sync_schedule FOR SELECT TO authenticated USING (public.is_admin_viewer(auth.uid()));
CREATE POLICY "Admins update sync schedule" ON public.sync_schedule FOR UPDATE TO authenticated USING (public.is_admin_viewer(auth.uid())) WITH CHECK (public.is_admin_viewer(auth.uid()));

-- Add section / unit / employment_type to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS section text,
  ADD COLUMN IF NOT EXISTS unit text,
  ADD COLUMN IF NOT EXISTS employment_type text;

-- Trigger to upsert org_units when profile changes
CREATE OR REPLACE FUNCTION public.sync_org_unit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.department IS NULL OR NEW.department = '' THEN RETURN NEW; END IF;
  INSERT INTO public.org_units (directorate, department, section, unit, employee_count)
  VALUES (COALESCE(NEW.directorate,''), NEW.department, COALESCE(NEW.section,''), COALESCE(NEW.unit,''), 1)
  ON CONFLICT (directorate, department, section, unit)
  DO UPDATE SET employee_count = public.org_units.employee_count + 1, updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_org_unit ON public.profiles;
CREATE TRIGGER trg_sync_org_unit
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_org_unit();

-- Initial backfill of org_units from existing profiles
INSERT INTO public.org_units (directorate, department, section, unit, employee_count)
SELECT COALESCE(directorate,''), department, COALESCE(section,''), COALESCE(unit,''), COUNT(*)
FROM public.profiles
WHERE department IS NOT NULL AND department <> ''
GROUP BY 1,2,3,4
ON CONFLICT (directorate, department, section, unit) DO UPDATE SET employee_count = EXCLUDED.employee_count, updated_at = now();

-- ai_reports table to store generated narrative reports
CREATE TABLE public.ai_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appraisal_id uuid NOT NULL REFERENCES public.appraisals(id) ON DELETE CASCADE,
  generated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  model text NOT NULL,
  narrative text NOT NULL,
  metrics jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_reports_appraisal_idx ON public.ai_reports(appraisal_id, created_at DESC);
GRANT SELECT, INSERT ON public.ai_reports TO authenticated;
GRANT ALL ON public.ai_reports TO service_role;
ALTER TABLE public.ai_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Employees view own reports" ON public.ai_reports FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.appraisals a WHERE a.id = appraisal_id
            AND (a.employee_id = auth.uid() OR a.chosen_supervisor_id = auth.uid() OR public.is_admin_viewer(auth.uid())))
  );
CREATE POLICY "Admins/supervisors insert reports" ON public.ai_reports FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.appraisals a WHERE a.id = appraisal_id
            AND (a.chosen_supervisor_id = auth.uid() OR public.is_admin_viewer(auth.uid())))
  );
