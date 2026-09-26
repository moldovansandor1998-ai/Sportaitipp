-- One scene image can be assigned to one output only, across every character.
create table public.content_source_images (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  asset_id uuid not null unique references public.assets(id) on delete cascade,
  pool text not null check (pool in ('tiktok','telegram_fanvue')),
  sha256 text not null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  unique (owner_id,sha256)
);
create index content_source_available on public.content_source_images(owner_id,pool,created_at) where used_at is null;
alter table public.content_source_images enable row level security;
create policy content_source_read on public.content_source_images for select to authenticated
  using (owner_id = (select auth.uid()));
grant select on public.content_source_images to authenticated;
grant select,insert,update,delete on public.content_source_images to service_role;

create table public.content_source_uses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  source_id uuid not null unique references public.content_source_images(id) on delete restrict,
  item_id uuid not null references public.model_content_items(id) on delete cascade,
  revision integer not null default 0,
  slide_no smallint not null check (slide_no between 0 and 2),
  used_at timestamptz not null default now(),
  unique(item_id,revision,slide_no)
);
alter table public.content_source_uses enable row level security;
create policy content_source_uses_read on public.content_source_uses for select to authenticated
  using (owner_id = (select auth.uid()));
grant select on public.content_source_uses to authenticated;
grant select,insert,update,delete on public.content_source_uses to service_role;

alter table public.model_content_items add column prepare_at timestamptz;
update public.model_content_items set prepare_at = due_at - interval '1 hour' where prepare_at is null;
alter table public.model_content_items alter column prepare_at set not null;
alter table public.model_content_items add column regeneration_count integer not null default 0;
create index model_content_prepare on public.model_content_items(status,prepare_at);

-- The API and cron use the service role. This claim is atomic even across workers.
create or replace function public.reserve_content_source(p_owner uuid,p_item uuid,p_pool text,p_slide smallint,p_revision integer)
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
    where owner_id=p_owner and pool=p_pool and used_at is null
    order by created_at,id for update skip locked limit 1;
  if not found then return; end if;
  update public.content_source_images set used_at=now() where id=v_source.id;
  insert into public.content_source_uses(owner_id,source_id,item_id,revision,slide_no)
    values(p_owner,v_source.id,p_item,p_revision,p_slide);
  return query select v_source.id,v_source.asset_id;
end $$;
revoke all on function public.reserve_content_source(uuid,uuid,text,smallint,integer) from public,anon,authenticated;
grant execute on function public.reserve_content_source(uuid,uuid,text,smallint,integer) to service_role;
