-- Keep each attempt for provenance. A rejected scene becomes available to a different
-- character, but a character cannot consume that scene twice.
alter table public.content_source_uses drop constraint if exists content_source_uses_source_id_key;
alter table public.content_source_uses add column character_id uuid references public.characters(id);
alter table public.content_source_uses add column review_status text not null default 'pending'
  check (review_status in ('pending','accepted','rejected'));
update public.content_source_uses u set character_id=i.character_id
  from public.model_content_items i where i.id=u.item_id;
alter table public.content_source_uses alter column character_id set not null;
create unique index content_source_one_active_use on public.content_source_uses(source_id)
  where review_status <> 'rejected';
create unique index content_source_one_character on public.content_source_uses(source_id,character_id);
create index content_source_uses_slide on public.content_source_uses(item_id,slide_no,revision desc);

create or replace function public.reserve_content_source(p_owner uuid,p_item uuid,p_pool text,p_slide smallint,p_revision integer,p_preferred uuid)
returns table(source_id uuid,asset_id uuid) language plpgsql security invoker set search_path = public as $$
declare v_source public.content_source_images%rowtype; v_character uuid;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'service_role_required'; end if;
  select character_id into v_character from public.model_content_items where id=p_item and owner_id=p_owner;
  if v_character is null then raise exception 'item_not_owned'; end if;
  return query select s.id,s.asset_id from public.content_source_uses u
    join public.content_source_images s on s.id=u.source_id
    where u.item_id=p_item and u.revision=p_revision and u.slide_no=p_slide and u.owner_id=p_owner;
  if found then return; end if;
  select * into v_source from public.content_source_images s
    where s.id=p_preferred and s.owner_id=p_owner and s.pool=p_pool and s.used_at is null
      and not exists (select 1 from public.content_source_uses u where u.source_id=s.id and u.character_id=v_character)
    for update skip locked;
  if not found then return; end if;
  update public.content_source_images set used_at=now() where id=v_source.id;
  insert into public.content_source_uses(owner_id,source_id,item_id,character_id,revision,slide_no)
    values(p_owner,v_source.id,p_item,v_character,p_revision,p_slide);
  return query select v_source.id,v_source.asset_id;
end $$;
revoke all on function public.reserve_content_source(uuid,uuid,text,smallint,integer,uuid) from public,anon,authenticated;
grant execute on function public.reserve_content_source(uuid,uuid,text,smallint,integer,uuid) to service_role;

-- A rejection releases the scene, but preserves the historical attempt and
-- prevents the same character from selecting the scene again.
create function public.reject_content_slide(p_owner uuid,p_item uuid,p_slide smallint)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_use public.content_source_uses%rowtype;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'service_role_required'; end if;
  select u.* into v_use from public.content_source_uses u
    where u.owner_id=p_owner and u.item_id=p_item and u.slide_no=p_slide
    order by u.revision desc limit 1 for update;
  if not found then raise exception 'source_not_found'; end if;
  if v_use.review_status='rejected' then return v_use.source_id; end if;
  update public.content_source_uses set review_status='rejected' where id=v_use.id;
  update public.content_source_images set used_at=null where id=v_use.source_id;
  return v_use.source_id;
end $$;
revoke all on function public.reject_content_slide(uuid,uuid,smallint) from public,anon,authenticated;
grant execute on function public.reject_content_slide(uuid,uuid,smallint) to service_role;
