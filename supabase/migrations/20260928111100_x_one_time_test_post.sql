-- A one-time test request is consumed by the existing authenticated cron.
alter table public.x_social_connections add column test_requested_at timestamptz;
alter table public.x_social_posts drop constraint x_social_posts_slot_check;
alter table public.x_social_posts add constraint x_social_posts_slot_check
  check (slot in ('morning', 'evening', 'test', '06:13', '08:37', '10:23',
    '12:03', '14:46', '17:06', '19:38', '20:49', '22:58', '23:29'));
