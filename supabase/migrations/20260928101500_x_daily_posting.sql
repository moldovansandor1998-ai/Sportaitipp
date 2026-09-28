-- X authorization and posting records contain secrets. Only the server-side
-- service role may access either table through the Data API.
create table public.x_social_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  x_user_id text not null,
  x_username text not null,
  encrypted_access_token text not null,
  encrypted_refresh_token text not null,
  token_expires_at timestamptz not null,
  enabled boolean not null default false,
  timezone text not null default 'Europe/Budapest',
  morning_minute smallint not null default 510 check (morning_minute between 0 and 1439),
  evening_minute smallint not null default 1230 check (evening_minute between 0 and 1439),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, character_id),
  unique(owner_id, x_user_id)
);
create index x_social_connections_enabled_idx on public.x_social_connections(enabled) where enabled;
alter table public.x_social_connections enable row level security;
revoke all on public.x_social_connections from public, anon, authenticated;
grant select, insert, update, delete on public.x_social_connections to service_role;

create table public.x_oauth_sessions (
  state text primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  encrypted_verifier text not null,
  return_origin text not null,
  expires_at timestamptz not null
);
alter table public.x_oauth_sessions enable row level security;
revoke all on public.x_oauth_sessions from public, anon, authenticated;
grant select, insert, delete on public.x_oauth_sessions to service_role;

create table public.x_social_posts (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.x_social_connections(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  gallery_item_id uuid references public.gallery_items(id) on delete set null,
  local_date date not null,
  slot text not null check (slot in ('morning','evening')),
  status text not null check (status in ('sending','posted','failed')),
  x_post_id text,
  error text,
  created_at timestamptz not null default now(),
  unique(connection_id, local_date, slot)
);
create index x_social_posts_recent_idx on public.x_social_posts(owner_id, created_at desc);
alter table public.x_social_posts enable row level security;
revoke all on public.x_social_posts from public, anon, authenticated;
grant select, insert, update, delete on public.x_social_posts to service_role;
