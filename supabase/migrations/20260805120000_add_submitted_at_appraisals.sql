-- Add submitted_at to appraisals to avoid PostgREST cache errors
ALTER TABLE public.appraisals
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

-- Ensure the column is visible to authenticated role (if using RLS policies that check columns)
GRANT SELECT, UPDATE ON public.appraisals TO service_role;
