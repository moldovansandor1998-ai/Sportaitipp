-- ============================================================
-- Castora 0011 – provider submission ledger
-- Egy Castora job SOHA ne indítson több fizetős provider-jobot
-- (timeout / retry / reaper esetén sem). A ledger a generation_jobs sor:
-- a provider_job_id NULL → még nem indítottunk; az első sikeres submit írja be.
-- ============================================================

-- Ki „nyeri meg” a submit jogot: csak az, aki még nem indított (provider_job_id IS NULL).
create or replace function public.begin_provider_submission(p_job uuid, p_provider text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare affected integer;
begin
  update public.generation_jobs
  set provider = p_provider
  where id = p_job and provider_job_id is null;
  get diagnostics affected = row_count;
  return affected > 0;
end $$;

-- Sikeres submit rögzítése: csak akkor, ha még nincs provider_job_id (versenyhelyzetbiztos).
create or replace function public.record_provider_submission(
  p_job uuid, p_provider_job_id text, p_meta jsonb
) returns boolean
language plpgsql security definer set search_path = public as $$
declare affected integer;
begin
  update public.generation_jobs
  set provider_job_id = p_provider_job_id, provider_meta = p_meta
  where id = p_job and provider_job_id is null;
  get diagnostics affected = row_count;
  return affected > 0;
end $$;

revoke execute on function public.begin_provider_submission(uuid, text) from public, anon, authenticated;
grant execute on function public.begin_provider_submission(uuid, text) to service_role;
revoke execute on function public.record_provider_submission(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_provider_submission(uuid, text, jsonb) to service_role;
