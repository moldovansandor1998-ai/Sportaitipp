-- ============================================================
-- Castora 0001 – séma (staging és production azonos)
-- Minden public táblán RLS, táblánként külön policy.
-- ============================================================
create extension if not exists pgcrypto;
create extension if not exists vector;

-- ---------- segédek ----------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

-- ---------- profilok ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'user' check (role in ('user','admin')),
  terms_accepted_at timestamptz,
  privacy_accepted_at timestamptz,
  age_verified_at timestamptz,
  banned_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- Admin jogosultság: csak server-side módosítható role oszlop alapján (definer-függvény).
-- A profiles tábla után készül, hogy üres adatbázison is alkalmazható legyen.
create or replace function public.is_admin() returns boolean
language sql security definer stable set search_path = public as
$$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;

create table public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  email_generation_done boolean not null default true,
  email_generation_failed boolean not null default true,
  email_credit_refund boolean not null default true,
  email_low_credit boolean not null default true,
  email_calendar_reminder boolean not null default true,
  timezone text not null default 'Europe/Budapest',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_user_settings_updated before update on public.user_settings
  for each row execute function public.set_updated_at();

-- ---------- karakterek ----------
create table public.characters (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text check (description is null or char_length(description) <= 2000),
  status text not null default 'draft'
    check (status in ('draft','collecting_refs','refs_qc','ready_to_train','training',
                      'test_pending','active','rejected','archived')),
  active_version_id uuid,
  consent_type text not null default 'ai_persona'
    check (consent_type in ('ai_persona','self','third_party_documented')),
  consent_document_asset_id uuid,
  is_spicy boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_characters_updated before update on public.characters
  for each row execute function public.set_updated_at();
create index idx_characters_owner on public.characters(owner_id);

create table public.character_versions (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  version_no integer not null,
  status text not null default 'queued'
    check (status in ('queued','training','test_pending','approved','rejected','failed')),
  provider text,
  provider_model_ref text,
  test_image_asset_id uuid,
  identity_score numeric(6,5) check (identity_score is null or identity_score between 0 and 1),
  qc_report jsonb not null default '{}'::jsonb,
  trained_at timestamptz,
  created_at timestamptz not null default now(),
  unique(character_id, version_no)
);

create table public.character_reference_images (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  asset_id uuid not null,
  kind text not null default 'face' check (kind in ('face','half_body','full_body')),
  is_primary boolean not null default false,
  sort_order integer not null default 0,
  qc_status text not null default 'pending'
    check (qc_status in ('pending','approved','rejected','duplicate')),
  qc_report jsonb not null default '{}'::jsonb,
  uploaded_at timestamptz not null default now()
);
create index idx_refimgs_character on public.character_reference_images(character_id);

create table public.character_voices (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  name text not null,
  provider text,
  provider_voice_ref text,
  status text not null default 'pending'
    check (status in ('pending','ready','failed','archived')),
  created_at timestamptz not null default now()
);

-- ---------- projektek ----------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('general','carousel','viral_trend','ppv_set')),
  created_at timestamptz not null default now()
);

-- ---------- feladatok ----------
create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  character_id uuid references public.characters(id) on delete set null,
  type text not null check (type in (
    'reference_qc','character_training','test_image','identity_check',
    'image_generation','image_edit','upscale','background_removal','skin_enhance',
    'video_from_image','talking_video','character_swap','motion_control','lip_sync',
    'tts','video_to_prompt','captioning','frame_extract','dataset_generation',
    'carousel_page','viral_scene','ppv_render'
  )),
  status text not null default 'draft' check (status in (
    'draft','awaiting_credit','queued','submitted','processing','quality_check',
    'completed','retrying','failed','cancelled','refunded'
  )),
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error jsonb,
  provider text not null default 'mock',
  provider_job_id text,
  provider_model text,
  attempt integer not null default 0,
  max_attempts integer not null default 3,
  cost_estimate integer not null default 0 check (cost_estimate >= 0),
  cost_final integer check (cost_final is null or cost_final >= 0),
  idempotency_key text unique,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_jobs_updated before update on public.generation_jobs
  for each row execute function public.set_updated_at();
create index idx_jobs_claim on public.generation_jobs(status, queued_at);
create index idx_jobs_owner on public.generation_jobs(owner_id, created_at desc);

create table public.generation_job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.generation_jobs(id) on delete cascade,
  from_status text,
  to_status text not null,
  message text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_job_events_job on public.generation_job_events(job_id);

create table public.provider_requests (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.generation_jobs(id) on delete cascade,
  provider text not null,
  endpoint text not null,
  request_body jsonb not null default '{}'::jsonb,
  response_status integer,
  response_body jsonb,
  latency_ms integer,
  created_at timestamptz not null default now()
);

-- ---------- eszközök / galéria ----------
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  bucket text not null,
  object_path text not null,
  media_type text not null check (media_type in ('image','video','audio','file')),
  content_type text not null,
  bytes bigint not null check (bytes > 0),
  sha256 text not null,
  source text not null default 'generation' check (source in ('upload','generation','import')),
  created_at timestamptz not null default now(),
  unique(bucket, object_path)
);
create index idx_assets_owner on public.assets(owner_id, created_at desc);

create table public.gallery_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  job_id uuid references public.generation_jobs(id) on delete set null,
  character_id uuid references public.characters(id) on delete set null,
  album_id uuid,
  title text,
  qc_status text not null default 'pending'
    check (qc_status in ('pending','approved','flagged','rejected')),
  created_at timestamptz not null default now()
);
create index idx_gallery_owner on public.gallery_items(owner_id, created_at desc);

create table public.albums (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.gallery_items
  add constraint fk_gallery_album foreign key (album_id) references public.albums(id) on delete set null;

-- ---------- sablonok / trendek ----------
create table public.templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete cascade, -- null = rendszersablon
  kind text not null check (kind in ('image','video','carousel','social','spicy')),
  name text not null,
  payload jsonb not null default '{}'::jsonb,
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.template_tags (
  template_id uuid not null references public.templates(id) on delete cascade,
  tag text not null,
  primary key (template_id, tag)
);

create table public.viral_trends (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete cascade, -- null = rendszertrend
  source_url text,
  title text not null,
  platform text check (platform in ('instagram','tiktok','other')),
  status text not null default 'ready' check (status in ('analyzing','ready','failed')),
  analysis jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.carousel_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  character_id uuid references public.characters(id) on delete set null,
  reference_asset_id uuid references public.assets(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft','processing','review','done','failed')),
  pages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table public.ppv_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  character_id uuid references public.characters(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft','first_render_pending','first_render_review','rendering','done','failed')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------- naptár ----------
create table public.content_calendar_posts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  character_id uuid references public.characters(id) on delete set null,
  platform text not null check (platform in ('instagram','tiktok','facebook','x','other')),
  status text not null default 'draft' check (status in ('draft','scheduled','posted','cancelled')),
  body text,
  media_asset_id uuid references public.assets(id) on delete set null,
  scheduled_at timestamptz not null,
  timezone text not null default 'Europe/Budapest',
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- kreditek ----------
create table public.credit_accounts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),  -- negatív egyenleg lehetetlen
  updated_at timestamptz not null default now()
);

create table public.credit_holds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  job_id uuid not null references public.generation_jobs(id) on delete cascade,
  amount integer not null check (amount > 0),
  status text not null default 'open' check (status in ('open','charged','released','refunded')),
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  hold_id uuid references public.credit_holds(id) on delete set null,
  type text not null check (type in ('grant','hold','charge','release','refund','purchase','admin_adjust')),
  amount integer not null,
  balance_after integer not null check (balance_after >= 0),
  idempotency_key text not null unique,
  note text,
  created_at timestamptz not null default now()
);
create index idx_ctx_user on public.credit_transactions(user_id, created_at desc);

-- ---------- előfizetés ----------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan text not null check (plan in ('free','starter','pro','studio')),
  status text not null default 'active' check (status in ('active','past_due','cancelled')),
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- e-mail / webhook ----------
create table public.email_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  template text not null,
  to_email text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending','sent','delivered','bounced','complained','skipped_suppressed','skipped_no_key','failed')),
  provider_message_id text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text,                              -- provider üzenet-azonosító (replay-védelem)
  signature_valid boolean not null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(provider, event_id)
);

-- ---------- moderáció / audit ----------
create table public.moderation_flags (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid references public.assets(id) on delete cascade,
  job_id uuid references public.generation_jobs(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  reason text not null check (reason in (
    'known_person','possible_minor','nonconsensual_intimate','csam_suspect',
    'consent_review','copyright','other'
  )),
  status text not null default 'open' check (status in ('open','resolved','false_positive')),
  resolver_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  target_type text,
  target_id text,
  meta jsonb not null default '{}'::jsonb,
  ip inet,
  created_at timestamptz not null default now()
);

create table public.admin_actions (
  id bigint generated always as identity primary key,
  admin_id uuid not null references public.profiles(id),
  action text not null,
  target_type text,
  target_id text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================
-- RLS – táblánként külön policy, nincs általános ciklus
-- ============================================================
alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.characters enable row level security;
alter table public.character_versions enable row level security;
alter table public.character_reference_images enable row level security;
alter table public.character_voices enable row level security;
alter table public.projects enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.generation_job_events enable row level security;
alter table public.provider_requests enable row level security;
alter table public.assets enable row level security;
alter table public.gallery_items enable row level security;
alter table public.albums enable row level security;
alter table public.templates enable row level security;
alter table public.template_tags enable row level security;
alter table public.viral_trends enable row level security;
alter table public.carousel_projects enable row level security;
alter table public.ppv_projects enable row level security;
alter table public.content_calendar_posts enable row level security;
alter table public.credit_accounts enable row level security;
alter table public.credit_holds enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.subscriptions enable row level security;
alter table public.email_events enable row level security;
alter table public.webhook_events enable row level security;
alter table public.moderation_flags enable row level security;
alter table public.audit_logs enable row level security;
alter table public.admin_actions enable row level security;

create policy "profiles_select_own" on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "profiles_update_own" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));

create policy "settings_select_own" on public.user_settings for select using (user_id = auth.uid());
create policy "settings_modify_own" on public.user_settings for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "characters_select_own" on public.characters for select using (owner_id = auth.uid() or public.is_admin());
create policy "characters_insert_own" on public.characters for insert with check (owner_id = auth.uid());
create policy "characters_update_own" on public.characters for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "characters_delete_own" on public.characters for delete using (owner_id = auth.uid());

create policy "cversions_select_own" on public.character_versions for select using (public.is_admin() or exists (select 1 from public.characters c where c.id = character_id and c.owner_id = auth.uid()));
create policy "cversions_modify_own" on public.character_versions for all using (exists (select 1 from public.characters c where c.id = character_id and c.owner_id = auth.uid())) with check (exists (select 1 from public.characters c where c.id = character_id and c.owner_id = auth.uid()));

create policy "refimgs_select_own" on public.character_reference_images for select using (exists (select 1 from public.characters c where c.id = character_id and c.owner_id = auth.uid()));
create policy "refimgs_modify_own" on public.character_reference_images for all using (exists (select 1 from public.characters c where c.id = character_id and c.owner_id = auth.uid())) with check (exists (select 1 from public.characters c where c.id = character_id and c.owner_id = auth.uid()));

create policy "voices_select_own" on public.character_voices for select using (exists (select 1 from public.characters c where c.id = character_id and c.owner_id = auth.uid()));
create policy "voices_modify_own" on public.character_voices for all using (exists (select 1 from public.characters c where c.id = character_id and c.owner_id = auth.uid())) with check (exists (select 1 from public.characters c where c.id = character_id and c.owner_id = auth.uid()));

create policy "projects_select_own" on public.projects for select using (owner_id = auth.uid() or public.is_admin());
create policy "projects_modify_own" on public.projects for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "jobs_select_own" on public.generation_jobs for select using (owner_id = auth.uid() or public.is_admin());
create policy "jobs_insert_own" on public.generation_jobs for insert with check (owner_id = auth.uid());
create policy "jobs_update_own" on public.generation_jobs for update using (owner_id = auth.uid() or public.is_admin()) with check (owner_id = auth.uid() or public.is_admin());
create policy "jobs_delete_own" on public.generation_jobs for delete using (owner_id = auth.uid());

create policy "jobevents_select_own" on public.generation_job_events for select using (public.is_admin() or exists (select 1 from public.generation_jobs j where j.id = job_id and j.owner_id = auth.uid()));

create policy "providerreq_admin" on public.provider_requests for select using (public.is_admin());

create policy "assets_select_own" on public.assets for select using (owner_id = auth.uid() or public.is_admin());
create policy "assets_modify_own" on public.assets for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "gallery_select_own" on public.gallery_items for select using (owner_id = auth.uid() or public.is_admin());
create policy "gallery_modify_own" on public.gallery_items for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "albums_select_own" on public.albums for select using (owner_id = auth.uid());
create policy "albums_modify_own" on public.albums for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "templates_select" on public.templates for select using (is_public or owner_id = auth.uid() or public.is_admin());
create policy "templates_modify_own" on public.templates for all using (owner_id = auth.uid() or public.is_admin()) with check (owner_id = auth.uid() or public.is_admin());

create policy "ttags_select" on public.template_tags for select using (exists (select 1 from public.templates t where t.id = template_id and (t.is_public or t.owner_id = auth.uid())));
create policy "ttags_modify" on public.template_tags for all using (exists (select 1 from public.templates t where t.id = template_id and t.owner_id = auth.uid())) with check (exists (select 1 from public.templates t where t.id = template_id and t.owner_id = auth.uid()));

create policy "trends_select" on public.viral_trends for select using (owner_id is null or owner_id = auth.uid() or public.is_admin());
create policy "trends_modify_own" on public.viral_trends for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "carousels_own" on public.carousel_projects for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "ppv_own" on public.ppv_projects for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "calposts_own" on public.content_calendar_posts for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "creditacct_select_own" on public.credit_accounts for select using (user_id = auth.uid() or public.is_admin());

create policy "holds_select_own" on public.credit_holds for select using (user_id = auth.uid() or public.is_admin());

create policy "ctx_select_own" on public.credit_transactions for select using (user_id = auth.uid() or public.is_admin());

create policy "subs_select_own" on public.subscriptions for select using (user_id = auth.uid() or public.is_admin());

create policy "emails_select_own" on public.email_events for select using (user_id = auth.uid() or public.is_admin());

create policy "webhooks_admin" on public.webhook_events for select using (public.is_admin());

create policy "modflags_select" on public.moderation_flags for select using (public.is_admin() or user_id = auth.uid());

create policy "audit_select_admin" on public.audit_logs for select using (public.is_admin());

create policy "adminactions_select" on public.admin_actions for select using (public.is_admin());
