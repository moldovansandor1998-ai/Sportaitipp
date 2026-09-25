-- ============================================================
-- Castora 0018 – image_generation DB-szintű karakterkötelezettség (fail-closed)
-- ============================================================

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
  if p_character is null and p_type in ('reference_qc','character_training','test_image','identity_check','image_generation') then
    raise exception 'CHARACTER_NOT_OWNED';
  end if;
  if p_project is not null and not exists
    (select 1 from public.projects where id = p_project and owner_id = p_owner) then
    raise exception 'PROJECT_NOT_OWNED';
  end if;

  -- image_generation: KÖTELEZŐ az aktív karakter, aktív APPROVED verzióval és LoRA-refjével
  if p_type = 'image_generation' then
    if not exists (
      select 1 from public.characters c
      where c.id = p_character and c.owner_id = p_owner and c.status = 'active'
        and c.active_version_id is not null
    ) then raise exception 'CHARACTER_NOT_ACTIVE'; end if;
    if not exists (
      select 1 from public.character_versions v
      join public.characters c on c.id = v.character_id
      where v.id = (select active_version_id from public.characters where id = p_character)
        and v.character_id = p_character and v.status = 'approved'
        and v.provider_model_ref is not null and length(v.provider_model_ref) > 0
    ) then raise exception 'NO_ACTIVE_LORA'; end if;
  end if;

  if p_character is not null and p_type in
    ('image_edit','video_from_image','talking_video','character_swap','motion_control') then
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
