-- Explicitly approved scenes may be reused for the same character on later
-- posts. Rejected scenes can move to another character; exhausted scenes retire.
alter table public.content_source_images add column preferred_for_character uuid references public.characters(id);
alter table public.content_source_images add column retired_at timestamptz;
drop index if exists public.content_source_one_active_use;
drop index if exists public.content_source_one_character;
create index content_source_preferred on public.content_source_images(owner_id,pool,preferred_for_character)
  where preferred_for_character is not null and retired_at is null;

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
    where s.id=p_preferred and s.owner_id=p_owner and s.pool=p_pool and s.retired_at is null
      and not exists (select 1 from public.content_source_uses u where u.source_id=s.id and u.item_id=p_item and u.review_status<>'rejected')
      and (
        (s.preferred_for_character=v_character and not exists
          (select 1 from public.content_source_uses u where u.source_id=s.id and u.character_id=v_character and u.review_status='rejected'))
        or (s.preferred_for_character is null and s.used_at is null and not exists
          (select 1 from public.content_source_uses u where u.source_id=s.id and u.character_id=v_character))
      )
    for update skip locked;
  if not found then return; end if;
  update public.content_source_images set used_at=now() where id=v_source.id and used_at is null;
  insert into public.content_source_uses(owner_id,source_id,item_id,character_id,revision,slide_no)
    values(p_owner,v_source.id,p_item,v_character,p_revision,p_slide);
  return query select v_source.id,v_source.asset_id;
end $$;
revoke all on function public.reserve_content_source(uuid,uuid,text,smallint,integer,uuid) from public,anon,authenticated;
grant execute on function public.reserve_content_source(uuid,uuid,text,smallint,integer,uuid) to service_role;

create or replace function public.reject_content_slide(p_owner uuid,p_item uuid,p_slide smallint)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_use public.content_source_uses%rowtype; v_other_active boolean; v_exhausted boolean;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'service_role_required'; end if;
  select u.* into v_use from public.content_source_uses u
    where u.owner_id=p_owner and u.item_id=p_item and u.slide_no=p_slide
    order by u.revision desc limit 1 for update;
  if not found then raise exception 'source_not_found'; end if;
  if v_use.review_status='rejected' then return v_use.source_id; end if;
  update public.content_source_uses set review_status='rejected' where id=v_use.id;
  select exists(select 1 from public.content_source_uses u where u.source_id=v_use.source_id and u.review_status<>'rejected') into v_other_active;
  select count(distinct u.character_id) >=
    (select count(*) from public.characters c where c.owner_id=p_owner and c.status='active' and c.active_version_id is not null)
    into v_exhausted from public.content_source_uses u where u.source_id=v_use.source_id;
  update public.content_source_images set
    preferred_for_character=null,
    retired_at=case when v_other_active or v_exhausted then now() else retired_at end,
    used_at=case when v_other_active then used_at else null end
    where id=v_use.source_id;
  return v_use.source_id;
end $$;
revoke all on function public.reject_content_slide(uuid,uuid,smallint) from public,anon,authenticated;
grant execute on function public.reject_content_slide(uuid,uuid,smallint) to service_role;
