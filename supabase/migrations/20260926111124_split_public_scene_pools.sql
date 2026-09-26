-- Older shared uploads, if any, remain available under Telegram.
alter table public.content_source_images drop constraint content_source_images_pool_check;
update public.content_source_images set pool='telegram' where pool='telegram_fanvue';
alter table public.content_source_images add constraint content_source_images_pool_check
  check(pool in ('tiktok','telegram','fanvue_public'));
