-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Remove that
-- inherited grant, then allow only the roles that evaluate authenticated RLS.
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
