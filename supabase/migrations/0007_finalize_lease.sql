-- ============================================================
-- Castora 0007 – finalizing állapot + lease + reaper + tranzakciós mock-flow
-- ============================================================

-- ---------- 1) finalizing állapot a job-gépben ----------
alter table public.generation_jobs drop constraint generation_jobs_status_check;
alter table public.generation_jobs add constraint generation_jobs_status_check check (status in (
  'draft','awaiting_credit','queued','submitted','processing','finalizing','quality_check',
  'completed','retrying','failed','cancelled','refunded'
));

insert into public.job_transition_rules (from_status, to_status) values
  ('submitted','finalizing'), ('processing','finalizing'),
  ('finalizing','completed'), ('finalizing','failed'), ('finalizing','refunded'), ('finalizing','processing')
on conflict do nothing;

alter table public.generation_jobs add column claimed_at timestamptz;

-- ---------- 2) finalize_claim lease-szel ----------
-- Atomikus lefoglalás; lejárt claim (10 perc) újrapróbálható – beragadt job nem marad.
create or replace function public.finalize_claim(p_job uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare affected integer;
begin
  update public.generation_jobs
  set status = 'finalizing', claimed_at = now()
  where id = p_job and (
    status in ('submitted','processing')
    or (status = 'finalizing' and claimed_at < now() - interval '10 minutes')
  );
  get diagnostics affected = row_count;
  return affected > 0;
end $$;

revoke execute on function public.finalize_claim(uuid) from public, anon, authenticated;
grant execute on function public.finalize_claim(uuid) to service_role;

-- ---------- 3) Reaper: beragadt feldolgozás vissza a sorba ----------
create or replace function public.reap_stale_jobs()
returns integer
language plpgsql security definer set search_path = public as $$
declare affected integer;
begin
  update public.generation_jobs
  set status = 'queued'
  where status in ('submitted','processing')
    and started_at < now() - interval '15 minutes';
  get diagnostics affected = row_count;
  return affected;
end $$;

revoke execute on function public.reap_stale_jobs() from public, anon, authenticated;
grant execute on function public.reap_stale_jobs() to service_role;

-- ---------- 4) reference_qc: refIds kötelező, nem üres, minden ID a karakteré ----------
create or replace function public.create_job_with_hold(
  p_owner uuid, p_type text, p_character uuid, p_project uuid,
  p_payload jsonb, p_key text, p_estimated integer
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_job uuid;
begin
  if p_character is not null and not exists
    (select 1 from public.characters where id = p_character and owner_id = p_owner) then
    raise exception 'CHARACTER_NOT_OWNED';
  end if;
  if p_character is null and p_type in
    ('reference_qc','character_training','test_image','identity_check') then
    raise exception 'CHARACTER_NOT_OWNED';
  end if;
  if p_project is not null and not exists
    (select 1 from public.projects where id = p_project and owner_id = p_owner) then
    raise exception 'PROJECT_NOT_OWNED';
  end if;
  if p_character is not null and p_type in
    ('image_generation','image_edit','video_from_image','talking_video','character_swap','motion_control') then
    if not exists (select 1 from public.characters where id = p_character and status = 'active') then
      raise exception 'CHARACTER_NOT_ACTIVE';
    end if;
  end if;

  -- Folyamat-előfeltételek (a költség és a provider-hívás előtt)
  if p_type = 'reference_qc' then
    if jsonb_typeof(p_payload -> 'refIds') <> 'array'
       or jsonb_array_length(p_payload -> 'refIds') = 0 then
      raise exception 'REFS_INVALID';
    end if;
    if exists (
      select 1 from jsonb_array_elements_text(p_payload -> 'refIds') as t(id)
      where not exists (
        select 1 from public.character_reference_images ri
        where ri.id = t.id::uuid and ri.character_id = p_character
      )
    ) then
      raise exception 'REF_NOT_OWNED';
    end if;
  elsif p_type = 'character_training' then
    if not exists (select 1 from public.characters where id = p_character and status = 'ready_to_train') then
      raise exception 'CHARACTER_NOT_READY';
    end if;
  elsif p_type = 'test_image' then
    if not exists (select 1 from public.characters where id = p_character and status = 'test_pending') then
      raise exception 'CHARACTER_NOT_TEST_PENDING';
    end if;
    if not exists (select 1 from public.character_versions
                   where character_id = p_character and status = 'test_pending') then
      raise exception 'NO_VERSION';
    end if;
  elsif p_type = 'identity_check' then
    if not exists (select 1 from public.character_versions
                   where character_id = p_character and status = 'test_pending'
                     and test_image_asset_id is not null) then
      raise exception 'CHARACTER_FLOW_INCOMPLETE';
    end if;
  end if;

  insert into public.generation_jobs (owner_id, type, character_id, project_id, payload,
                                      status, cost_estimate, idempotency_key)
  values (p_owner, p_type, p_character, p_project, p_payload,
          'awaiting_credit', p_estimated, p_key)
  returning id into v_job;

  perform public.credit_hold(p_owner, v_job, p_estimated, 'hold:' || v_job);
  update public.generation_jobs set status = 'queued' where id = v_job;
  return v_job;
end $$;

revoke execute on function public.create_job_with_hold(uuid, text, uuid, uuid, jsonb, text, integer) from public, anon, authenticated;
grant execute on function public.create_job_with_hold(uuid, text, uuid, uuid, jsonb, text, integer) to service_role;

-- ---------- 5) Tranzakciós mock karakterfolyamat ----------
-- A karakterfolyamat DB-módosításai egyetlen tranzakcióban: vagy mind sikerül, vagy semmi.
-- A függvény újraellenőrzi a tulajdont és a refIds-t (védelmi mélység).
create or replace function public.apply_mock_flow_step(
  p_job uuid, p_type text, p_character uuid, p_first_asset uuid, p_ref_ids uuid[]
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
    if p_ref_ids is null or array_length(p_ref_ids, 1) is null then
      raise exception 'REFS_INVALID';
    end if;
    if exists (
      select 1 from unnest(p_ref_ids) as t(id)
      where not exists (
        select 1 from public.character_reference_images ri
        where ri.id = t.id and ri.character_id = p_character
      )
    ) then
      raise exception 'REF_NOT_OWNED';
    end if;
    update public.character_reference_images
    set qc_status = 'approved',
        qc_report = '{"faceCount":1,"blurScore":0.98,"duplicate":false,"engine":"mock"}'::jsonb
    where character_id = p_character and id = any(p_ref_ids);
    update public.characters set status = 'refs_qc'
      where id = p_character and status = 'collecting_refs';
    update public.characters set status = 'ready_to_train'
      where id = p_character and status = 'refs_qc';

  elsif p_type = 'character_training' then
    update public.characters set status = 'training'
      where id = p_character and status = 'ready_to_train';
    if not found then raise exception 'CHARACTER_NOT_READY'; end if;
    select coalesce(max(version_no), 0) + 1 into v_next
      from public.character_versions where character_id = p_character;
    insert into public.character_versions
      (character_id, version_no, status, provider, provider_model_ref, trained_at)
    values (p_character, v_next, 'test_pending', 'mock',
            'mock_lora_' || p_character || '_v' || v_next, now())
    returning id into v_version;
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
    update public.characters set status = 'active'
      where id = p_character and status = 'test_pending';
    update public.characters set active_version_id = v_version where id = p_character;
  end if;
end $$;

revoke execute on function public.apply_mock_flow_step(uuid, text, uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.apply_mock_flow_step(uuid, text, uuid, uuid, uuid[]) to service_role;
