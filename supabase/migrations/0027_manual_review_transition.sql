-- Follow the character state machine's required collecting_refs -> refs_qc -> ready_to_train path.
create or replace function public.approve_character_references_manual(
  p_character uuid, p_owner uuid, p_ref_ids uuid[]
) returns integer
language plpgsql security definer set search_path = public
as $$
declare v_status text; v_count integer;
begin
  select status into v_status from public.characters
  where id = p_character and owner_id = p_owner for update;
  if v_status is distinct from 'collecting_refs' then raise exception 'REFERENCES_NOT_READY'; end if;
  v_count := coalesce(array_length(p_ref_ids, 1), 0);
  if v_count < 3 or v_count > 40 or
     (select count(distinct x) from unnest(p_ref_ids) as x) <> v_count or
     (select count(*) from public.character_reference_images
      where character_id = p_character and qc_status = 'pending') <> v_count or
     (select count(*) from public.character_reference_images
      where character_id = p_character and qc_status = 'pending' and id = any(p_ref_ids)) <> v_count
  then raise exception 'REFS_INVALID'; end if;
  update public.character_reference_images
  set qc_status = 'approved',
      qc_report = jsonb_build_object('method', 'owner_visual_review', 'technical', 'mime_size_sha256_duplicate', 'reviewed_at', now())
  where character_id = p_character and id = any(p_ref_ids);
  update public.characters set status = 'refs_qc' where id = p_character;
  update public.characters set status = 'ready_to_train' where id = p_character;
  return v_count;
end;
$$;

revoke all on function public.approve_character_references_manual(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.approve_character_references_manual(uuid, uuid, uuid[]) to service_role;
