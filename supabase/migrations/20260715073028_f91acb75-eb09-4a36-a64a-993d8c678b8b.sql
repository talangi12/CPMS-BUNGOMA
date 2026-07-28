
ALTER TABLE public.departments
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.contract_signoffs
  ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_contract_signoffs_contract_owner
  ON public.contract_signoffs (contract_id, is_owner);
