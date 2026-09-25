-- ============================================================
-- Castora 0016 – verzió↔job kötés, párhuzamos tréning tiltás, ZIP-életciklus, overload-drop
-- ============================================================

-- ---- verzió-kiegészítések ----
alter table public.character_versions
  add column generation_job_id uuid,
  add column destination text,
  add column dataset_object_path text,
  add column dataset_expires_at timestamptz,
  add column provider_job_id text,
  add column preparation_key text;
create unique index if not exists uq_versions_prep_key on public.character_versions(character_id, preparation_key);
create index if not exists idx_versions_job on public.character_versions(generation_job_id);

-- ---- claim v3: tulajdon + állapot + EGY aktív attempt + idempotens kulcs ----
create or replace function public.claim_character_version(
  p_character uuid, p_provider text, p_job uuid, p_destination text, p_dataset_path text, p_preparation_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid; v_status text; v_next integer; v_id uuid;
begin
  select owner_id, status into v_owner, v_status from public.characters where id = p_character;
  if v_owner is null then raise exception 'CHARACTER_NOT_FOUND'; end if;
  if v_status <> 'ready_to_train' then raise exception 'CHARACTER_NOT_READY'; end if;

  -- idempotencia: ugyanazzal a kulccsal a meglévő foglalást adjuk vissza
  select id, version_no into v_id, v_next from public.character_versions
  where character_id = p_character and preparation_key = p_preparation_key;
  if found then
    return jsonb_build_object('version_id', v_id, 'version_no', v_next);
  end if;

  perform pg_advisory_xact_lock(hashtext(p_character::text));
  -- a lock ALATT újra: két egyidejű sessionből pontosan egy nyerhet
  select id, version_no into v_id, v_next from public.character_versions
  where character_id = p_character and preparation_key = p_preparation_key;
  if found then
    return jsonb_build_object('version_id', v_id, 'version_no', v_next);
  end if;
  if exists (select 1 from public.character_versions
             where character_id = p_character and status = 'training') then
    raise exception 'TRAINING_ALREADY_ACTIVE';
  end if;

  select coalesce(max(version_no), 0) + 1 into v_next
    from public.character_versions where character_id = p_character;
  insert into public.character_versions
    (character_id, version_no, status, provider, generation_job_id, destination,
     dataset_object_path, provider_job_id, preparation_key)
  values (p_character, v_next, 'training', p_provider, p_job, p_destination, p_dataset_path, null, p_preparation_key)
  returning id into v_id;
  return jsonb_build_object('version_id', v_id, 'version_no', v_next);
end $$;
revoke execute on function public.claim_character_version(uuid, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_character_version(uuid, text, uuid, text, text, text) to service_role;

-- ---- create_job_with_hold: verzió-kötés a tréning jobhoz (versenyhelyzetbiztos) ----
create or replace function public.create_job_with_hold(
  p_owner uuid, p_type text, p_character uuid, p_project uuid,
  p_payload jsonb, p_key text, p_estimated integer
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_job uuid; v_version uuid;
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

  if p_type = 'reference_qc' then
    if jsonb_typeof(p_payload -> 'refIds') <> 'array' or jsonb_array_length(p_payload -> 'refIds') = 0 then
      raise exception 'REFS_INVALID';
    end if;
    if exists (
      select 1 from jsonb_array_elements_text(p_payload -> 'refIds') as t(id)
      where not exists (select 1 from public.character_reference_images ri
                        where ri.id = t.id::uuid and ri.character_id = p_character)
    ) then raise exception 'REF_NOT_OWNED'; end if;
  elsif p_type = 'character_training' then
    if not exists (select 1 from public.characters where id = p_character and status = 'ready_to_train') then
      raise exception 'CHARACTER_NOT_READY';
    end if;
    -- tréning KÖTELEZŐEN verzióhoz kötött (prep által claimelt)
    v_version := (p_payload ->> 'versionId')::uuid;
    if v_version is null then raise exception 'VERSION_ID_REQUIRED'; end if;
    if not exists (select 1 from public.character_versions
                   where id = v_version and character_id = p_character and status = 'training') then
      raise exception 'VERSION_NOT_CLAIMED';
    end if;
    if jsonb_typeof(p_payload -> 'imagesDataUrl') is distinct from 'string'
       and jsonb_typeof(p_payload -> 'imagesZipUrl') is distinct from 'string' then
      raise exception 'DATASET_REQUIRED';
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
    if not exists (
      select 1 from public.character_versions
      where character_id = p_character and status = 'test_pending'
        and test_image_asset_id is not null
        and provider is not null and provider <> 'mock'
    ) then raise exception 'IDENTITY_REQUIRES_REAL_PROVIDER'; end if;
  end if;

  insert into public.generation_jobs (owner_id, type, character_id, project_id, payload,
                                      status, cost_estimate, idempotency_key)
  values (p_owner, p_type, p_character, p_project, p_payload, 'awaiting_credit', p_estimated, p_key)
  returning id into v_job;

  -- verzió-kötés: csak ha még nincs jobja (két job nem kötheti ugyanazt)
  if p_type = 'character_training' then
    update public.character_versions set generation_job_id = v_job
    where id = v_version and generation_job_id is null;
    if not found then raise exception 'VERSION_ALREADY_BOUND'; end if;
  end if;

  perform public.credit_hold(p_owner, v_job, p_estimated, 'hold:' || v_job);
  update public.generation_jobs set status = 'queued' where id = v_job;
  return v_job;
end $$;
revoke execute on function public.create_job_with_hold(uuid, text, uuid, uuid, jsonb, text, integer) from public, anon, authenticated;
grant execute on function public.create_job_with_hold(uuid, text, uuid, uuid, jsonb, text, integer) to service_role;

-- ---- flow: KIZÁRÓLAG a jobhoz kötött verzió frissül; két job sosem írja egymásét ----
create or replace function public.apply_mock_flow_step(
  p_job uuid, p_type text, p_character uuid, p_first_asset uuid, p_ref_ids uuid[],
  p_provider text default 'mock', p_weights text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_version uuid; v_next integer;
begin
  if not exists (
    select 1 from public.generation_jobs j join public.characters c on c.id = p_character
    where j.id = p_job and j.character_id = p_character and c.owner_id = j.owner_id
  ) then raise exception 'FLOW_NOT_OWNED'; end if;

  if p_type = 'reference_qc' then
    if p_ref_ids is null or array_length(p_ref_ids, 1) is null then raise exception 'REFS_INVALID'; end if;
    if exists (select 1 from unnest(p_ref_ids) t(id)
               where not exists (select 1 from public.character_reference_images ri
                                 where ri.id = t.id and ri.character_id = p_character)) then
      raise exception 'REF_NOT_OWNED';
    end if;
    update public.character_reference_images
    set qc_status = 'approved', qc_report = '{"faceCount":1,"blurScore":0.98,"duplicate":false,"engine":"mock"}'::jsonb
    where character_id = p_character and id = any(p_ref_ids);
    update public.characters set status = 'refs_qc' where id = p_character and status = 'collecting_refs';
    update public.characters set status = 'ready_to_train' where id = p_character and status = 'refs_qc';

  elsif p_type = 'character_training' then
    update public.characters set status = 'training'
      where id = p_character and status = 'ready_to_train';
    if not found then raise exception 'CHARACTER_NOT_READY'; end if;
    -- KIZÁRÓLAG a jobhoz kötött verzió (nem „legújabb”)
    update public.character_versions
    set provider = p_provider, provider_model_ref = coalesce(p_weights, provider_model_ref),
        status = 'test_pending', trained_at = now(),
        provider_job_id = coalesce(provider_job_id, (select provider_job_id from public.generation_jobs where id = p_job))
    where generation_job_id = p_job and status = 'training';
    if not found then
      -- legacy fallback (prep nélküli régi folyamat)
      select id into v_version from public.character_versions
      where character_id = p_character and status = 'training'
      order by version_no desc limit 1;
      if found then
        update public.character_versions
        set provider = p_provider, provider_model_ref = coalesce(p_weights, provider_model_ref),
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

-- ---- TELJES overload-tisztítás ----
drop function if exists public.apply_mock_flow_step(uuid, text, uuid, uuid, uuid[]);
drop function if exists public.apply_mock_flow_step(uuid, text, uuid, uuid, uuid[], text);
drop function if exists public.complete_job_transactional(uuid, uuid, uuid[]);
drop function if exists public.complete_job_transactional(uuid, uuid, uuid[], text);
drop function if exists public.claim_character_version(uuid, text);
drop function if exists public.claim_character_version(uuid, text, uuid, text, text);
