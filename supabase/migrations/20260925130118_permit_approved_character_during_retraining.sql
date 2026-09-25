-- Allow existing approved characters to remain usable in image editing while
-- their next training version is collecting references.
DO $migration$
DECLARE
  definition text;
  old_guard text := 'if not exists (select 1 from public.characters where id = p_character and status = ''active'') then';
  new_guard text := 'if not exists (select 1 from public.characters c where c.id = p_character and c.owner_id = p_owner and (c.status = ''active'' or (p_type in (''image_edit'', ''character_swap'') and c.active_version_id is not null and exists (select 1 from public.character_versions v where v.id = c.active_version_id and v.character_id = c.id and v.status = ''approved'')))) then';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'create_job_with_hold';
  IF definition IS NULL OR position(old_guard IN definition) = 0 THEN
    RAISE EXCEPTION 'create_job_with_hold guard changed; migration requires review';
  END IF;
  EXECUTE replace(definition, old_guard, new_guard);
END $migration$;
