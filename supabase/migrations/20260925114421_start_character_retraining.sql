-- Explicit owner-triggered reset for a new model version. Preserve the existing
-- approved version for audit and rollback while references are reviewed again.
create or replace function public.begin_character_retraining(p_character uuid, p_owner uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_status text; v_active uuid; v_count integer;
begin
  select status, active_version_id into v_status, v_active from public.characters
  where id = p_character and owner_id = p_owner for update;
  if v_status is distinct from 'active' or v_active is null then raise exception 'CHARACTER_NOT_ACTIVE'; end if;
  if not exists (select 1 from public.character_versions where id = v_active
                 and character_id = p_character and status = 'approved') then
    raise exception 'NO_APPROVED_VERSION';
  end if;
  if exists (select 1 from public.character_versions where character_id = p_character
             and status in ('prepared', 'training', 'test_pending')) then
    raise exception 'TRAINING_ALREADY_ACTIVE';
  end if;
  select count(*) into v_count from public.character_reference_images where character_id = p_character;
  if v_count < 3 or v_count > 40 then raise exception 'INVALID_REFERENCE_COUNT'; end if;
  update public.character_reference_images set qc_status = 'pending', qc_report = '{}'::jsonb
  where character_id = p_character;
  update public.characters set status = 'collecting_refs' where id = p_character;
  return v_count;
end;
$$;
revoke all on function public.begin_character_retraining(uuid, uuid) from public, anon, authenticated;
grant execute on function public.begin_character_retraining(uuid, uuid) to service_role;
