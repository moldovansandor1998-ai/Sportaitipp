alter table public.x_social_posts
  drop constraint x_social_posts_connection_image_unique;

-- X explicitly rejected these posts before publishing. Their images can be retried.
-- Keep every other claim, including uncertain network failures, unique.
create unique index x_social_posts_connection_image_claimed_idx
  on public.x_social_posts(connection_id, gallery_item_id)
  where gallery_item_id is not null
    and (status <> 'failed' or error is distinct from 'X_POST_402');
