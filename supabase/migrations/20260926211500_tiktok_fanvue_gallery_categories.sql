alter table public.bulk_generation_items
  add column if not exists content_category text not null default 'tiktok'
  check (content_category in ('tiktok','fanvue'));

alter table public.gallery_items
  add column if not exists content_category text not null default 'tiktok'
  check (content_category in ('tiktok','fanvue'));

create index if not exists bulk_generation_owner_category_idx
  on public.bulk_generation_items (owner_id, content_category, created_at desc);

create index if not exists gallery_items_owner_category_idx
  on public.gallery_items (owner_id, content_category, created_at desc);
