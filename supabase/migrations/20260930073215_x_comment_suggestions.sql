create table public.x_comment_suggestions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  connection_id uuid not null references public.x_social_connections(id) on delete cascade,
  x_post_id text not null,
  x_author_username text not null,
  post_text text not null,
  like_count integer not null default 0,
  reply_count integer not null default 0,
  repost_count integer not null default 0,
  view_count bigint,
  post_created_at timestamptz not null,
  suggestion text not null,
  status text not null default 'pending' check (status in ('pending','posting','posted','rejected')),
  x_reply_id text,
  error text,
  created_at timestamptz not null default now(),
  acted_at timestamptz,
  unique(owner_id, x_post_id)
);
create index x_comment_suggestions_queue_idx on public.x_comment_suggestions(owner_id,character_id,status,post_created_at desc);
alter table public.x_comment_suggestions enable row level security;
revoke all on public.x_comment_suggestions from public, anon, authenticated;
grant select, insert, update on public.x_comment_suggestions to service_role;

create table public.x_comment_scan_runs (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  window_start timestamptz not null,
  created_at timestamptz not null default now(),
  primary key(owner_id,window_start)
);
alter table public.x_comment_scan_runs enable row level security;
revoke all on public.x_comment_scan_runs from public, anon, authenticated;
grant select, insert on public.x_comment_scan_runs to service_role;
