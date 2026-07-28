
-- 1) Notification preferences on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS personal_email text,
  ADD COLUMN IF NOT EXISTS notify_email boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_sms boolean NOT NULL DEFAULT true;

-- 2) Extend otp_codes for password-reset purpose (reuses existing table)
ALTER TABLE public.otp_codes
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'login';

-- 3) Resolve any identifier (ID number OR personal number) to the synthetic login email.
CREATE OR REPLACE FUNCTION public.resolve_identifier(_identifier text)
RETURNS TABLE(user_id uuid, email text, phone_number text, personal_email text, full_name text, must_change_password boolean, employee_status employee_status)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, email, phone_number, personal_email, full_name, must_change_password, employee_status
  FROM public.profiles
  WHERE id_number = _identifier OR personal_number = _identifier
  LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION public.resolve_identifier(text) TO anon, authenticated;

-- 4) Default-password helper: standardised constant for imports
CREATE OR REPLACE FUNCTION public.default_employee_password()
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'BUNGOMA*039.'::text $$;
GRANT EXECUTE ON FUNCTION public.default_employee_password() TO authenticated, service_role;
