-- ============================================================
-- Castora 0014 – a provider_model_ref CSAK sikeres tréning után legyen értelmes:
-- a tréning output weights URL-je kerül a verzióba (mocknál marad a mock-ref).
-- ============================================================

create or replace function public.apply_mock_flow_step(
  p_job uuid, p_type text, p_character uuid, p_first_asset uuid, p_ref_ids uuid[], p_weights text default null
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
            coalesce(p_weights, 'mock_lora_' || p_character || '_v' || v_next), now())
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

revoke execute on function public.apply_mock_flow_step(uuid, text, uuid, uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.apply_mock_flow_step(uuid, text, uuid, uuid, uuid[], text) to service_role;

-- A tranzakciós véglegesítés továbbadja a súlyokat (a finalize az output meta-ból tölti)
create or replace function public.complete_job_transactional(p_job uuid, p_first_asset uuid, p_ref_ids uuid[], p_weights text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_job public.generation_jobs%rowtype;
begin
  select * into v_job from public.generation_jobs where id = p_job for update;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  if v_job.status <> 'finalizing' then raise exception 'JOB_NOT_FINALIZING'; end if;

  if v_job.type in ('reference_qc','character_training','test_image','identity_check')
     and v_job.character_id is not null then
    perform public.apply_mock_flow_step(v_job.id, v_job.type, v_job.character_id, p_first_asset, p_ref_ids, p_weights);
  end if;

  perform public.credit_charge_hold(p_job, 'charge:' || p_job);

  update public.generation_jobs
  set status = 'completed', cost_final = cost_estimate, finished_at = now()
  where id = p_job;
end $$;

revoke execute on function public.complete_job_transactional(uuid, uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.complete_job_transactional(uuid, uuid, uuid[], text) to service_role;
