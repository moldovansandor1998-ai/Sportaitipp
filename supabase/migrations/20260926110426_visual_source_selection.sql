-- Reserve the visual planner's chosen image without falling back to another
-- model's scene. The old five-argument function remains for in-flight jobs.
create function public.reserve_content_source(p_owner uuid,p_item uuid,p_pool text,p_slide smallint,p_revision integer,p_preferred uuid)
returns table(source_id uuid,asset_id uuid) language plpgsql security invoker set search_path = public as $$
declare v_source public.content_source_images%rowtype;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'service_role_required'; end if;
  if not exists (select 1 from public.model_content_items where id=p_item and owner_id=p_owner) then
    raise exception 'item_not_owned';
  end if;
  return query select s.id,s.asset_id from public.content_source_uses u
    join public.content_source_images s on s.id=u.source_id
    where u.item_id=p_item and u.revision=p_revision and u.slide_no=p_slide and u.owner_id=p_owner;
  if found then return; end if;
  select * into v_source from public.content_source_images
    where id=p_preferred and owner_id=p_owner and pool=p_pool and used_at is null
    for update skip locked;
  if not found then return; end if;
  update public.content_source_images set used_at=now() where id=v_source.id;
  insert into public.content_source_uses(owner_id,source_id,item_id,revision,slide_no)
    values(p_owner,v_source.id,p_item,p_revision,p_slide);
  return query select v_source.id,v_source.asset_id;
end $$;
revoke all on function public.reserve_content_source(uuid,uuid,text,smallint,integer,uuid) from public,anon,authenticated;
grant execute on function public.reserve_content_source(uuid,uuid,text,smallint,integer,uuid) to service_role;
