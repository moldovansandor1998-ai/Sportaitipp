create table public.model_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  character_id uuid references public.characters(id) on delete set null,
  model_name text not null,
  platform text not null check (platform in ('fanvue','tiktok','telegram')),
  login_email text not null,
  account_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, model_name, platform, login_email)
);
create index model_accounts_owner on public.model_accounts(owner_id);
create trigger model_accounts_updated before update on public.model_accounts for each row execute function public.set_updated_at();
alter table public.model_accounts enable row level security;
create policy model_accounts_own on public.model_accounts for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()) and
    (character_id is null or exists(select 1 from public.characters c where c.id = character_id and c.owner_id = (select auth.uid()))));
grant select, insert, update, delete on public.model_accounts to authenticated;

create table public.model_content_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  platform text not null check(platform in ('tiktok','telegram','fanvue_public','fanvue_paid')),
  local_date date not null,
  post_hour smallint not null check(post_hour in (12,16,20)),
  due_at timestamptz not null,
  aspect_ratio text not null check(aspect_ratio in ('9:16','flexible')),
  status text not null default 'planned' check(status in ('planned','generating','ready','failed','posted')),
  trend_title text,
  trend_url text,
  trend_checked_at timestamptz,
  copy jsonb not null default '{}'::jsonb,
  image_jobs uuid[] not null default '{}',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(character_id,platform,local_date,post_hour)
);
create index model_content_due on public.model_content_items(status,due_at);
create trigger model_content_updated before update on public.model_content_items for each row execute function public.set_updated_at();
alter table public.model_content_items enable row level security;
create policy model_content_own on public.model_content_items for select to authenticated using(owner_id = (select auth.uid()));
create policy model_content_update on public.model_content_items for update to authenticated
  using(owner_id = (select auth.uid())) with check(owner_id = (select auth.uid()));
grant select, update on public.model_content_items to authenticated;
