-- Explicit Data API grant-ok minimalis jogosultsagokkal (RLS valtozatlan)
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on public.profiles, public.user_settings, public.characters,
  public.character_versions, public.character_reference_images, public.character_voices,
  public.projects, public.generation_jobs, public.generation_job_events,
  public.assets, public.gallery_items, public.albums, public.templates,
  public.template_tags, public.viral_trends, public.carousel_projects,
  public.ppv_projects, public.content_calendar_posts, public.credit_accounts,
  public.subscriptions to authenticated;
grant insert, delete on public.characters to authenticated;
grant update (name, description, is_spicy) on public.characters to authenticated;
grant insert on public.character_reference_images, public.assets to authenticated;
grant insert, update, delete on public.albums, public.projects,
  public.content_calendar_posts to authenticated;
grant update on public.user_settings to authenticated;
grant delete on public.gallery_items to authenticated;

grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
