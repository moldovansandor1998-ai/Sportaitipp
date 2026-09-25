create or replace function public.link_bulk_generation_job(p_item uuid, p_job uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.bulk_generation_items b
    set status='started', job_id=p_job, error=null
  where b.id=p_item and b.status in ('claimed','started')
    and exists (select 1 from public.generation_jobs j
      where j.id=p_job and j.owner_id=b.owner_id
        and j.idempotency_key='bulk:'||b.id::text);
  return found;
end $$;
revoke execute on function public.link_bulk_generation_job(uuid,uuid) from public, anon, authenticated;
grant execute on function public.link_bulk_generation_job(uuid,uuid) to service_role;
