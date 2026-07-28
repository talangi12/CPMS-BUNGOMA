
ALTER TABLE public.workplans
  ADD COLUMN IF NOT EXISTS document_path text,
  ADD COLUMN IF NOT EXISTS document_name text,
  ADD COLUMN IF NOT EXISTS document_type text,
  ADD COLUMN IF NOT EXISTS document_size bigint,
  ADD COLUMN IF NOT EXISTS directorate text,
  ADD COLUMN IF NOT EXISTS department text;
