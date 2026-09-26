-- A published/used gallery image remains available in the archive and in its
-- original content package. This flag is independent of the source-scene use.
alter table public.gallery_items add column used_at timestamptz;
create index gallery_used_archive on public.gallery_items(owner_id,used_at desc)
  where deleted_at is null and used_at is not null;
