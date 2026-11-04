-- Additive and disabled by default: this does not alter X tables or schedules.
create table public.reddit_social_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  reddit_user_id text not null,
  reddit_username text not null,
  encrypted_access_token text not null,
  encrypted_refresh_token text not null,
  token_expires_at timestamptz not null,
  enabled boolean not null default false,
  timezone text not null default 'Europe/Budapest',
  subreddit text,
  posting_minutes integer[] not null default array[600,900,1200]
    check (cardinality(posting_minutes) between 1 and 4 and 0 <= all(posting_minutes) and 1439 >= all(posting_minutes)),
  rules_confirmed boolean not null default false,
  rules_fingerprint text,
  pause_reason text,
  last_discovery_at timestamptz,
  discovery_lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,character_id),
  unique(reddit_user_id),
  check (not enabled or (subreddit is not null and rules_confirmed))
);
create index reddit_connections_enabled_idx on public.reddit_social_connections(updated_at) where enabled;

create table public.reddit_oauth_sessions (
  state text primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  return_origin text not null,
  expires_at timestamptz not null
);
create index reddit_oauth_expiry_idx on public.reddit_oauth_sessions(expires_at);

create table public.reddit_social_posts (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references public.reddit_social_connections(id) on delete set null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  reddit_user_id text not null,
  gallery_item_id uuid references public.gallery_items(id) on delete set null,
  subreddit text not null,
  local_date date not null,
  slot text not null check (slot ~ '^[0-2][0-9]:[0-5][0-9]$'),
  status text not null check (status in ('preparing','sending','posted','failed','uncertain')),
  title text,
  caption text,
  fanvue_url text,
  image_sha256 text,
  image_phash text,
  reddit_post_id text,
  permalink text,
  error text,
  created_at timestamptz not null default now(),
  posted_at timestamptz,
  unique(connection_id,local_date,slot),
  unique(owner_id,image_sha256),
  unique(owner_id,image_phash)
);
create index reddit_posts_recent_idx on public.reddit_social_posts(owner_id,created_at desc);
create index reddit_posts_unresolved_idx on public.reddit_social_posts(connection_id,status,created_at)
  where status in ('sending','uncertain');

create table public.reddit_publishing_locks (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  lease_token uuid not null,
  expires_at timestamptz not null
);

create table public.reddit_community_candidates (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  subreddit text not null,
  title text not null,
  description text not null,
  over18 boolean not null default false,
  status text not null check (status in ('eligible','needs_review','blocked')),
  reason text not null,
  rules jsonb not null default '[]'::jsonb,
  checked_at timestamptz not null default now(),
  primary key(owner_id,character_id,subreddit)
);

-- OAuth credentials and posting/discovery ledgers are server-only. Owners access
-- sanitized views via authenticated Next.js routes, never directly via Data API.
alter table public.reddit_social_connections enable row level security;
alter table public.reddit_oauth_sessions enable row level security;
alter table public.reddit_social_posts enable row level security;
alter table public.reddit_community_candidates enable row level security;
alter table public.reddit_publishing_locks enable row level security;
revoke all on public.reddit_social_connections,public.reddit_oauth_sessions,
  public.reddit_social_posts,public.reddit_community_candidates,public.reddit_publishing_locks from public,anon,authenticated;
grant select,insert,update,delete on public.reddit_social_connections,public.reddit_oauth_sessions,
  public.reddit_social_posts,public.reddit_community_candidates,public.reddit_publishing_locks to service_role;
