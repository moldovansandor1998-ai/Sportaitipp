-- ============================================================
-- Castora 0012 – submission ledger v2 (versenyhelyzetbiztos mutex)
-- - begin: JSONB-flag atomi mutex – két párhuzamos workerből PONTOSAN EGY nyer
-- - record: a TÉNYLEGESEN használt provider (failover után is helyes) + meta,
--   csak ha még nincs provider_job_id
-- - bizonytalan submit-timeout után NINCS automatikus újraküldés:
--   a flag blokkolja; az ilyen job emberi ellenőrzésre vár (refund + admin)
-- ============================================================

create or replace function public.begin_provider_submission(p_job uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare affected integer;
begin
  update public.generation_jobs
  set provider_meta = provider_meta || '{"submission_started": true}'::jsonb
  where id = p_job
    and provider_job_id is null
    and coalesce(provider_meta ->> 'submission_started', 'false') <> 'true';
  get diagnostics affected = row_count;
  return affected > 0;   -- pontosan egy feldolgozó kaphat true-t
end $$;

create or replace function public.record_provider_submission(
  p_job uuid, p_provider text, p_provider_job_id text, p_meta jsonb
) returns boolean
language plpgsql security definer set search_path = public as $$
declare affected integer;
begin
  update public.generation_jobs
  set provider = p_provider,              -- a TÉNYLEGESEN használt adapter (failover után is helyes)
      provider_job_id = p_provider_job_id,
      provider_meta = p_meta
  where id = p_job and provider_job_id is null;
  get diagnostics affected = row_count;
  return affected > 0;
end $$;

revoke execute on function public.begin_provider_submission(uuid) from public, anon, authenticated;
grant execute on function public.begin_provider_submission(uuid) to service_role;
revoke execute on function public.record_provider_submission(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_provider_submission(uuid, text, text, jsonb) to service_role;
