alter table public.model_accounts alter column login_email drop not null;

update public.model_accounts set account_url = case model_name
  when 'Zsófia' then 'https://www.tiktok.com/@zsfi.oldala'
  when 'Dorika' then 'https://www.tiktok.com/@dorika2006'
  when 'Dorina' then 'https://www.tiktok.com/@jakabdorinatelegram'
  when 'Laura' then 'https://www.tiktok.com/@tg_lauramasikoldala'
  else account_url end
where platform = 'tiktok' and model_name in ('Zsófia', 'Dorika', 'Dorina', 'Laura');

insert into public.model_accounts (owner_id, character_id, model_name, platform, login_email, account_url)
select owner_id, id, name, 'telegram', null, case name
  when 'Zsófia' then 'https://t.me/zsofioldala'
  when 'Dorina' then 'https://t.me/jakabdorina'
  when 'Laura' then 'https://t.me/lauramasikoldala'
  when 'Dorika' then 'https://t.me/dorika2006' end
from public.characters c
where name in ('Zsófia', 'Dorina', 'Laura', 'Dorika')
  and not exists (select 1 from public.model_accounts a where a.owner_id = c.owner_id
    and a.character_id = c.id and a.platform = 'telegram');

update public.model_accounts set account_url = case model_name
  when 'Zsófia' then 'https://t.me/zsofioldala'
  when 'Dorina' then 'https://t.me/jakabdorina'
  when 'Laura' then 'https://t.me/lauramasikoldala'
  when 'Dorika' then 'https://t.me/dorika2006'
  else account_url end
where platform = 'telegram' and model_name in ('Zsófia', 'Dorina', 'Laura', 'Dorika');
