-- Remove appraisal contract enforcement so appraisals are no longer blocked by contract signing
DROP TRIGGER IF EXISTS trg_enforce_contract_before_appraisal ON public.appraisals;

CREATE OR REPLACE FUNCTION public.enforce_contract_before_appraisal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN NEW;
END $$;

GRANT EXECUTE ON FUNCTION public.enforce_contract_before_appraisal() TO authenticated;
