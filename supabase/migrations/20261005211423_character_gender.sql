-- Matches the production migration recorded by Supabase.
alter table public.characters add column gender text not null default 'female'
  check (gender in ('female','male'));
update public.characters set gender='male'
where owner_id='56413297-fc33-4c66-ba2f-25371a40202e'
  and id in ('0b3d1a82-288d-43f0-b91f-b0cf0c2261e8','8c2c0d94-3fb0-460c-b811-e8f80d51c460');
