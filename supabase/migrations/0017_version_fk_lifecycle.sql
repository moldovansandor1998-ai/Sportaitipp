-- ============================================================
-- Castora 0017 – verzió↔job FK + UNIQUE + életciklus-állapotok
-- ============================================================

alter table public.character_versions drop constraint character_versions_status_check;
alter table public.character_versions add constraint character_versions_status_check check (status in (
  'queued','prepared','training','test_pending','approved','rejected','failed','expired'
));

-- Egy jobhoz legfeljebb EGY verzió; a kötés FK-val is védve
alter table public.character_versions
  add constraint fk_versions_job foreign key (generation_job_id)
  references public.generation_jobs(id) on delete set null;
create unique index if not exists uq_versions_one_job
  on public.character_versions(generation_job_id) where generation_job_id is not null;

-- claim: „prepared" állapot (aktív attempt = prepared vagy training)
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

  select id, version_no into v_id, v_next from public.character_versions
  where character_id = p_character and preparation_key = p_preparation_key;
  if found then return jsonb_build_object('version_id', v_id, 'version_no', v_next); end if;

  perform pg_advisory_xact_lock(hashtext(p_character::text));
  select id, version_no into v_id, v_next from public.character_versions
  where character_id = p_character and preparation_key = p_preparation_key;
  if found then return jsonb_build_object('version_id', v_id, 'version_no', v_next); end if;
  if exists (select 1 from public.character_versions
             where character_id = p_character and status in ('prepared','training')) then
    raise exception 'TRAINING_ALREADY_ACTIVE';
  end if;

  select coalesce(max(version_no), 0) + 1 into v_next
    from public.character_versions where character_id = p_character;
  insert into public.character_versions
    (character_id, version_no, status, provider, generation_job_id, destination,
     dataset_object_path, provider_job_id, preparation_key)
  values (p_character, v_next, 'prepared', p_provider, p_job, p_destination, p_dataset_path, null, p_preparation_key)
  returning id into v_id;
  return jsonb_build_object('version_id', v_id, 'version_no', v_next);
end $$;
revoke execute on function public.claim_character_version(uuid, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_character_version(uuid, text, uuid, text, text, text) to service_role;

-- create_job_with_hold: a kötött verzió prepared-ből trainingbe indul
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
  if p_character is null and p_type in ('reference_qc','character_training','test_image','identity_check') then
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
    if exists (select 1 from jsonb_array_elements_text(p_payload -> 'refIds') as t(id)
               where not exists (select 1 from public.character_reference_images ri
                                 where ri.id = t.id::uuid and ri.character_id = p_character)) then
      raise exception 'REF_NOT_OWNED';
    end if;
  elsif p_type = 'character_training' then
    if not exists (select 1 from public.characters where id = p_character and status = 'ready_to_train') then
      raise exception 'CHARACTER_NOT_READY';
    end if;
    v_version := (p_payload ->> 'versionId')::uuid;
    if v_version is null then raise exception 'VERSION_ID_REQUIRED'; end if;
    if not exists (select 1 from public.character_versions
                   where id = v_version and character_id = p_character and status = 'prepared') then
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
    if not exists (select 1 from public.character_versions
                   where character_id = p_character and status = 'test_pending'
                     and test_image_asset_id is not null
                     and provider is not null and provider <> 'mock') then
      raise exception 'IDENTITY_REQUIRES_REAL_PROVIDER';
    end if;
  end if;

  insert into public.generation_jobs (owner_id, type, character_id, project_id, payload,
                                      status, cost_estimate, idempotency_key)
  values (p_owner, p_type, p_character, p_project, p_payload, 'awaiting_credit', p_estimated, p_key)
  returning id into v_job;

  if p_type = 'character_training' then
    update public.character_versions set generation_job_id = v_job, status = 'training'
    where id = v_version and generation_job_id is null;
    if not found then raise exception 'VERSION_ALREADY_BOUND'; end if;
  end if;

  perform public.credit_hold(p_owner, v_job, p_estimated, 'hold:' || v_job);
  update public.generation_jobs set status = 'queued' where id = v_job;
  return v_job;
end $$;
revoke execute on function public.create_job_with_hold(uuid, text, uuid, uuid, jsonb, text, integer) from public, anon, authenticated;
grant execute on function public.create_job_with_hold(uuid, text, uuid, uuid, jsonb, text, integer) to service_role;
