-- is_admin() is used by authenticated RLS policies, but must not be exposed
-- to unauthenticated callers through the Data API.
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon;
