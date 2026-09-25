-- ============================================================
-- Castora 0009 – reaper started_at javítás
-- (a 0008 már lefuthatott környezeteken; minden változás ÚJ migrációban)
-- ============================================================

create or replace function public.reap_stale_jobs()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[];
begin
  select array_agg(id) into v_ids
  from public.generation_jobs
  where status in ('submitted','processing')
    and started_at < now() - interval '15 minutes';

  if v_ids is null then return 0; end if;

  update public.generation_jobs set status = 'retrying', started_at = null where id = any(v_ids);
  update public.generation_jobs set status = 'queued', started_at = null where id = any(v_ids);
  return array_length(v_ids, 1);
end $$;

revoke execute on function public.reap_stale_jobs() from public, anon, authenticated;
grant execute on function public.reap_stale_jobs() to service_role;
