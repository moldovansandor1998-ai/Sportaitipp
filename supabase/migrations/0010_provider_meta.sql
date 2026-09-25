-- Provider által visszaadott meta (response_url/status_url, model verzió, weights stb.)
alter table public.generation_jobs add column provider_meta jsonb not null default '{}'::jsonb;
