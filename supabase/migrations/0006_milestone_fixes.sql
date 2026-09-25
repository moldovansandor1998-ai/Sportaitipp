-- ============================================================
-- Castora 0006 – mérföldkő-javítások
-- ============================================================

-- ---------- 1) characters.status CHECK összehangolva az FSM-mel (failed hiányzott) ----------
alter table public.characters drop constraint characters_status_check;
alter table public.characters add constraint characters_status_check check (status in (
  'draft','collecting_refs','refs_qc','ready_to_train','training','test_pending',
  'active','rejected','failed','archived'
));

-- ---------- 2) TELJES UPDATE-revoke, majd kizárólag megengedett oszlopok grantje ----------
revoke update on public.characters from anon, authenticated;
grant update (name, description, is_spicy) on public.characters to authenticated;

-- ---------- 3) Prekondíció-kapuk a provider-hívás és a kreditlevonás ELŐTT ----------
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
    if not exists (select 1 from public.character_reference_images where character_id = p_character) then
      raise exception 'NO_REFERENCES';
    end if;
  elsif p_type = 'character_training' then
    if not exists (select 1 from public.characters where id = p_character and status = 'ready_to_train') then
      raise exception 'CHARACTER_NOT_READY';
    end if;
  elsif p_type = 'test_image' then
    if not exists (select 1 from public.character_versions where character_id = p_character) then
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

-- ---------- 4) Finalizálás atomi, adatbázis-szintű lefoglalása ----------
-- (a minősítésbe állítás a lock: két párhuzamos webhookból csak egy nyer)
create or replace function public.finalize_claim(p_job uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare affected integer;
begin
  update public.generation_jobs
  set status = 'quality_check'
  where id = p_job and status in ('submitted','processing');
  get diagnostics affected = row_count;
  return affected > 0;
end $$;

revoke execute on function public.finalize_claim(uuid) from public, anon, authenticated;
grant execute on function public.finalize_claim(uuid) to service_role;

-- ---------- 5) Duplikáció elleni unique kapcsolat ----------
create unique index if not exists uq_gallery_owner_asset
  on public.gallery_items(owner_id, asset_id);
