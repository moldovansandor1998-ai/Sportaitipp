create table public.x_follow_candidates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  x_user_id text not null,
  x_username text not null,
  display_name text not null default '',
  description text not null default '',
  source_post text,
  status text not null default 'saved' check (status in ('saved','reviewed','dismissed')),
  created_at timestamptz not null default now(),
  unique (owner_id, character_id, x_user_id)
);
create index x_follow_candidates_owner_idx on public.x_follow_candidates(owner_id, character_id, created_at desc);
alter table public.x_follow_candidates enable row level security;
revoke all on public.x_follow_candidates from public, anon, authenticated;
grant select, insert, update, delete on public.x_follow_candidates to service_role;
