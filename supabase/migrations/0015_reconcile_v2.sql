-- ============================================================
-- Castora 0015 – reconcile v2, atomi verziófoglalás, reaper v2, overload-tisztítás
-- ============================================================

-- ---- tisztítás: régi overload-ok explicit eldobása ----
drop function if exists public.apply_mock_flow_step(uuid, text, uuid, uuid, uuid[]);
drop function if exists public.complete_job_transactional(uuid, uuid, uuid[]);

-- ---- átmenet: submitted → submission_uncertain ----
insert into public.job_transition_rules (from_status, to_status)
values ('submitted','submission_uncertain') on conflict do nothing;

-- ---- atomi verziófoglalás (advisory lock; a destination a foglalt számból készül) ----
create or replace function public.claim_character_version(p_character uuid, p_provider text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_next integer;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_character::text));  -- ugyanazon karakter tréningjei szerializálva
  select coalesce(max(version_no), 0) + 1 into v_next
    from public.character_versions where character_id = p_character;
  insert into public.character_versions (character_id, version_no, status, provider, provider_model_ref)
  values (p_character, v_next, 'training', p_provider, null)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.claim_character_version(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_character_version(uuid, text) to service_role;

-- ---- flow: TÉNYLEGES provider + foglalt verzió frissítése (nem új insert) ----
create or replace function public.apply_mock_flow_step(
  p_job uuid, p_type text, p_character uuid, p_first_asset uuid, p_ref_ids uuid[],
  p_provider text default 'mock', p_weights text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_version uuid;
  v_next integer;
begin
  if not exists (
    select 1 from public.generation_jobs j
    join public.characters c on c.id = p_character
    where j.id = p_job and j.character_id = p_character and c.owner_id = j.owner_id
  ) then
    raise exception 'FLOW_NOT_OWNED';
  end if;

  if p_type = 'reference_qc' then
    if p_ref_ids is null or array_length(p_ref_ids, 1) is null then raise exception 'REFS_INVALID'; end if;
    if exists (
      select 1 from unnest(p_ref_ids) t(id)
      where not exists (select 1 from public.character_reference_images ri
                        where ri.id = t.id and ri.character_id = p_character)
    ) then raise exception 'REF_NOT_OWNED'; end if;
    update public.character_reference_images
    set qc_status = 'approved',
        qc_report = '{"faceCount":1,"blurScore":0.98,"duplicate":false,"engine":"mock"}'::jsonb
    where character_id = p_character and id = any(p_ref_ids);
    update public.characters set status = 'refs_qc' where id = p_character and status = 'collecting_refs';
    update public.characters set status = 'ready_to_train' where id = p_character and status = 'refs_qc';

  elsif p_type = 'character_training' then
    update public.characters set status = 'training'
      where id = p_character and status = 'ready_to_train';
    if not found then raise exception 'CHARACTER_NOT_READY'; end if;
    -- foglalt (prep által claimelt) verzió frissítése; ha nincs, legacy insert
    select id into v_version from public.character_versions
    where character_id = p_character and status = 'training'
    order by version_no desc limit 1;
    if found then
      update public.character_versions
      set provider = p_provider,                                  -- TÉNYLEGES provider
          provider_model_ref = coalesce(p_weights, provider_model_ref),
          status = 'test_pending', trained_at = now()
      where id = v_version;
    else
      select coalesce(max(version_no), 0) + 1 into v_next
        from public.character_versions where character_id = p_character;
      insert into public.character_versions
        (character_id, version_no, status, provider, provider_model_ref, trained_at)
      values (p_character, v_next, 'test_pending', p_provider,
              coalesce(p_weights, 'lora_' || p_character || '_v' || v_next), now());
    end if;
    update public.characters set status = 'test_pending'
      where id = p_character and status = 'training';

  elsif p_type = 'test_image' then
    if not exists (select 1 from public.characters where id = p_character and status = 'test_pending') then
      raise exception 'CHARACTER_NOT_TEST_PENDING';
    end if;
    select id into v_version from public.character_versions
    where character_id = p_character and status = 'test_pending'
    order by version_no desc limit 1;
    if not found then raise exception 'NO_VERSION'; end if;
    update public.character_versions set test_image_asset_id = p_first_asset where id = v_version;

  elsif p_type = 'identity_check' then
    select id into v_version from public.character_versions
    where character_id = p_character and status = 'test_pending'
      and test_image_asset_id is not null
    order by version_no desc limit 1;
    if not found then raise exception 'CHARACTER_FLOW_INCOMPLETE'; end if;
    update public.character_versions
    set identity_score = 0.95, status = 'approved', qc_report = '{"engine":"mock"}'::jsonb
    where id = v_version;
    update public.characters set status = 'active' where id = p_character and status = 'test_pending';
    update public.characters set active_version_id = v_version where id = p_character;
  end if;
end $$;
revoke execute on function public.apply_mock_flow_step(uuid, text, uuid, uuid, uuid[], text, text) from public, anon, authenticated;
grant execute on function public.apply_mock_flow_step(uuid, text, uuid, uuid, uuid[], text, text) to service_role;

-- ---- tranzakciós véglegesítés: tényleges provider átadva ----
create or replace function public.complete_job_transactional(
  p_job uuid, p_first_asset uuid, p_ref_ids uuid[], p_provider text default 'mock', p_weights text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_job public.generation_jobs%rowtype;
begin
  select * into v_job from public.generation_jobs where id = p_job for update;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  if v_job.status <> 'finalizing' then raise exception 'JOB_NOT_FINALIZING'; end if;

  if v_job.type in ('reference_qc','character_training','test_image','identity_check')
     and v_job.character_id is not null then
    perform public.apply_mock_flow_step(
      v_job.id, v_job.type, v_job.character_id, p_first_asset, p_ref_ids,
      coalesce(nullif(v_job.provider, ''), p_provider), p_weights);
  end if;

  perform public.credit_charge_hold(p_job, 'charge:' || p_job);

  update public.generation_jobs
  set status = 'completed', cost_final = cost_estimate, finished_at = now()
  where id = p_job;
end $$;
revoke execute on function public.complete_job_transactional(uuid, uuid, uuid[], text, text) from public, anon, authenticated;
grant execute on function public.complete_job_transactional(uuid, uuid, uuid[], text, text) to service_role;

-- ---- reaper v2: submission_started + nincs provider_job_id → submission_uncertain (manual review) ----
create or replace function public.reap_stale_jobs()
returns integer
language plpgsql security definer set search_path = public as $$
declare v_ids uuid[]; v_uncertain integer;
begin
  -- bizonytalan submitok: NEM újraindítjuk – manual review
  with u as (
    select id from public.generation_jobs
    where status in ('submitted','processing')
      and started_at < now() - interval '15 minutes'
      and provider_job_id is null
      and coalesce(provider_meta ->> 'submission_started', 'false') = 'true'
  )
  update public.generation_jobs j
  set status = 'submission_uncertain',
      error = coalesce(error, '{}'::jsonb) || '{"reaper": "submission_started without provider_job_id"}'::jsonb
  where j.id in (select id from u);
  get diagnostics v_uncertain = row_count;

  -- régi, még nem indított jobok: szabályos újraindítás
  select array_agg(id) into v_ids from public.generation_jobs
  where status in ('submitted','processing')
    and started_at < now() - interval '15 minutes'
    and coalesce(provider_meta ->> 'submission_started', 'false') <> 'true';
  if v_ids is not null then
    update public.generation_jobs set status = 'retrying' where id = any(v_ids);
    update public.generation_jobs set status = 'queued', started_at = null where id = any(v_ids);
  end if;
  return v_uncertain + coalesce(array_length(v_ids, 1), 0);
end $$;
revoke execute on function public.reap_stale_jobs() from public, anon, authenticated;
grant execute on function public.reap_stale_jobs() to service_role;

-- ---- reconcile RPC-k (atomi, auditált, konkurenciabiztos) ----
create or replace function public.admin_mark_submitted(
  p_job uuid, p_provider text, p_provider_job_id text, p_admin uuid, p_reason text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare affected integer;
begin
  if p_provider not in ('fal','replicate') then raise exception 'INVALID_PROVIDER'; end if;
  perform 1 from public.profiles where id = p_admin and role = 'admin';
  if not found then raise exception 'invalid admin'; end if;
  update public.generation_jobs
  set provider = p_provider, provider_job_id = p_provider_job_id,
      provider_meta = provider_meta || jsonb_build_object('recovered', true, 'recovery_reason', p_reason),
      status = 'processing', error = null
  where id = p_job and status = 'submission_uncertain';
  get diagnostics affected = row_count;
  if affected = 0 then return false; end if;   -- már nem uncertain (idempotens)
  insert into public.audit_logs (actor_id, action, target_type, target_id, meta)
  values (p_admin, 'admin.job.mark_submitted', 'job', p_job::text,
          jsonb_build_object('provider', p_provider, 'provider_job_id', p_provider_job_id, 'reason', p_reason));
  return true;
end $$;
revoke execute on function public.admin_mark_submitted(uuid, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_mark_submitted(uuid, text, text, uuid, text) to service_role;

create or replace function public.admin_mark_failed(p_job uuid, p_admin uuid, p_reason text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare affected integer; v_owner uuid; v_cost integer;
begin
  perform 1 from public.profiles where id = p_admin and role = 'admin';
  if not found then raise exception 'invalid admin'; end if;
  select owner_id, cost_estimate into v_owner, v_cost from public.generation_jobs
  where id = p_job and status = 'submission_uncertain' for update;
  if v_owner is null then return false; end if;   -- már nem uncertain (idempotens)

  update public.generation_jobs
  set status = 'failed', error = jsonb_build_object('message', 'admin: ' || p_reason, 'recovered', true)
  where id = p_job;
  -- refund hiba NEM nyelődik el – kivétel → teljes tranzakció visszagörget
  perform public.credit_refund_job(p_job, 'refund:' || p_job);
  update public.generation_jobs set status = 'refunded' where id = p_job;
  insert into public.audit_logs (actor_id, action, target_type, target_id, meta)
  values (p_admin, 'admin.job.mark_failed', 'job', p_job::text,
          jsonb_build_object('reason', p_reason, 'refunded', v_cost));
  return true;
end $$;
revoke execute on function public.admin_mark_failed(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_mark_failed(uuid, uuid, text) to service_role;

create or replace function public.admin_restart(p_job uuid, p_admin uuid, p_reason text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare affected integer; v_old text;
begin
  perform 1 from public.profiles where id = p_admin and role = 'admin';
  if not found then raise exception 'invalid admin'; end if;
  select status into v_old from public.generation_jobs
  where id = p_job and status = 'submission_uncertain' for update;
  if v_old is null then return false; end if;

  update public.generation_jobs
  set status = 'queued', provider_meta = '{}'::jsonb, error = null, started_at = null
  where id = p_job;
  insert into public.audit_logs (actor_id, action, target_type, target_id, meta)
  values (p_admin, 'admin.job.restart', 'job', p_job::text,
          jsonb_build_object('from', v_old, 'to', 'queued', 'reason', p_reason));
  return true;
end $$;
revoke execute on function public.admin_restart(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_restart(uuid, uuid, text) to service_role;
