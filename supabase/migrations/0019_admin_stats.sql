-- Admin: jobok státuszonként + felhasználói aggregáció (csak service role)
create or replace function public.admin_jobs_by_status()
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return coalesce((
    select jsonb_object_agg(status, count)
    from (select status, count(*)::int as count from public.generation_jobs group by status) t
  ), '{}'::jsonb);
end $$;
revoke execute on function public.admin_jobs_by_status() from public, anon, authenticated;
grant execute on function public.admin_jobs_by_status() to service_role;
