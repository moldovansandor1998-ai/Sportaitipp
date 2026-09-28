-- Retain the original slot values for any historical posts while adding
-- fixed Budapest-time slots for the ten-post schedule.
alter table public.x_social_posts drop constraint x_social_posts_slot_check;
alter table public.x_social_posts add constraint x_social_posts_slot_check
  check (slot in ('morning', 'evening', '06:13', '08:37', '10:23',
    '12:03', '14:46', '17:06', '19:38', '20:49', '22:58', '23:29'));

-- Enforce lifetime one-time use per X account even if the scheduler history
-- query is paginated or two invocations overlap.
alter table public.x_social_posts
  add constraint x_social_posts_connection_image_unique unique (connection_id, gallery_item_id);
