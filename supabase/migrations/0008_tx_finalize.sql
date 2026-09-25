-- ============================================================
-- Castora 0008 – reaper-javítás + tranzakciós job-véglegesítés
-- ============================================================

-- ---------- 1) reaper: submitted/processing → retrying → queued ----------
-- (mindkettő szabályos átmenet az állapotgépben; trigger- és TS-kompatibilis)
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

  update public.generation_jobs set status = 'retrying' where id = any(v_ids);
  update public.generation_jobs set status = 'queued' where id = any(v_ids);
  return array_length(v_ids, 1);
end $$;

revoke execute on function public.reap_stale_jobs() from public, anon, authenticated;
grant execute on function public.reap_stale_jobs() to service_role;

-- ---------- 2) Teljes véglegesítés EGY tranzakcióban ----------
-- flow (karakter/verzió) + kredit-charge + completed: vagy mind sikerül, vagy semmi.
-- Hívása csak 'finalizing' állapotból lehetséges (a finalize_claim adja a lease-t).
create or replace function public.complete_job_transactional(p_job uuid, p_first_asset uuid, p_ref_ids uuid[])
returns void
language plpgsql security definer set search_path = public as $$
declare v_job public.generation_jobs%rowtype;
begin
  select * into v_job from public.generation_jobs where id = p_job for update;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  if v_job.status <> 'finalizing' then raise exception 'JOB_NOT_FINALIZING'; end if;

  -- karakterfolyamat (önálló tranzakciós RPC; tulajdon- és kapu-ellenőrzéssel)
  if v_job.type in ('reference_qc','character_training','test_image','identity_check')
     and v_job.character_id is not null then
    perform public.apply_mock_flow_step(v_job.id, v_job.type, v_job.character_id, p_first_asset, p_ref_ids);
  end if;

  -- kreditelszámolás (idempotens; hiba esetén az egész tranzakció visszagörget,
  -- így a karakter nem léphet elő sikertelen charge mellett)
  perform public.credit_charge_hold(p_job, 'charge:' || p_job);

  -- befejezés
  update public.generation_jobs
  set status = 'completed', cost_final = cost_estimate, finished_at = now()
  where id = p_job;
end $$;

revoke execute on function public.complete_job_transactional(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.complete_job_transactional(uuid, uuid, uuid[]) to service_role;
