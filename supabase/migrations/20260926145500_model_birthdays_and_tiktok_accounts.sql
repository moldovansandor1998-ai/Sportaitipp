alter table public.characters add column if not exists birth_date date;

update public.characters set birth_date = case name
  when 'Dorika' then date '2006-11-28'
  when 'Laura' then date '2006-03-04'
  when 'Dorina' then date '2005-08-12'
  when 'Zsófia' then date '2002-01-08'
  when 'Petra' then date '1998-06-25'
  else birth_date end
where name in ('Dorika', 'Laura', 'Dorina', 'Zsófia', 'Petra');

insert into public.model_accounts (owner_id, character_id, model_name, platform, login_email)
select owner_id, id, name, 'tiktok', case name
  when 'Laura' then 'nenekincso@gmail.com'
  when 'Zsófia' then 'horvathzsofi77@gmail.com' end
from public.characters
where name in ('Laura', 'Zsófia')
on conflict (owner_id, model_name, platform, login_email) do nothing;

update public.model_accounts set notes = null
where (model_name = 'Laura' and platform = 'fanvue' and notes = 'nenekincso@gmail.com   Tiktok fiok')
   or (model_name = 'Zsófia' and platform = 'fanvue' and notes = 'horvathzsofi77@gmail.com     TikTok');
