
ALTER FUNCTION public.touch_updated_at() SET search_path = public;
ALTER FUNCTION public.classify_rating(numeric) SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.classify_rating(numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.classify_rating(numeric) TO authenticated;
