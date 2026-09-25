-- ============================================================
-- Castora 0002 – atomi kreditműveletek, állapotgép, claim
-- ============================================================

-- ---------- regisztráció: profil + beállítások + kreditszámla ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email,
    terms_accepted_at, privacy_accepted_at, age_verified_at)
  values (new.id, new.email,
    case when (new.raw_user_meta_data->>'terms_accepted')::boolean then now() end,
    case when (new.raw_user_meta_data->>'privacy_accepted')::boolean then now() end,
    case when (new.raw_user_meta_data->>'age_verified')::boolean then now() end);
  insert into public.user_settings (user_id) values (new.id);
  insert into public.credit_accounts (user_id, balance) values (new.id, 200); -- indító kredit
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- állapotgép (adatbázis-szintű kényszer) ----------
create table public.job_transition_rules (
  from_status text not null,
  to_status text not null,
  primary key (from_status, to_status)
);

insert into public.job_transition_rules (from_status, to_status) values
  ('draft','awaiting_credit'), ('draft','cancelled'),
  ('awaiting_credit','queued'), ('awaiting_credit','cancelled'), ('awaiting_credit','failed'),
  ('queued','submitted'), ('queued','cancelled'), ('queued','failed'),
  ('submitted','processing'), ('submitted','retrying'), ('submitted','failed'), ('submitted','cancelled'),
  ('processing','quality_check'), ('processing','retrying'), ('processing','failed'),
  ('quality_check','completed'), ('quality_check','retrying'), ('quality_check','failed'), ('quality_check','refunded'),
  ('retrying','queued'), ('retrying','submitted'), ('retrying','failed'), ('retrying','cancelled'),
  ('failed','refunded'), ('failed','retrying');

create or replace function public.enforce_job_transition() returns trigger
language plpgsql as $$
begin
  if old.status = new.status then return new; end if;
  if not exists (select 1 from public.job_transition_rules
                 where from_status = old.status and to_status = new.status) then
    raise exception 'illegal job transition: % → % (job %)', old.status, new.status, old.id;
  end if;
  if new.status in ('submitted','processing') and old.status not in ('submitted','processing') then
    new.started_at = coalesce(new.started_at, now());
  end if;
  if new.status in ('completed','failed','cancelled','refunded') then
    new.finished_at = coalesce(new.finished_at, now());
  end if;
  return new;
end $$;

create trigger trg_job_transition before update on public.generation_jobs
  for each row execute function public.enforce_job_transition();

create or replace function public.log_job_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status is distinct from new.status then
    insert into public.generation_job_events (job_id, from_status, to_status)
    values (new.id, old.status, new.status);
  end if;
  return new;
end $$;

create trigger trg_job_event after update on public.generation_jobs
  for each row execute function public.log_job_event();

-- ---------- atomi claim (több feldolgozó nem veheti fel ugyanazt) ----------
create or replace function public.claim_next_job()
returns setof public.generation_jobs
language plpgsql security definer set search_path = public as $$
declare claimed uuid;
begin
  select id into claimed
  from public.generation_jobs
  where status = 'queued'
  order by queued_at
  limit 1
  for update skip locked;

  if claimed is null then return; end if;

  return query
  update public.generation_jobs
  set status = 'submitted', attempt = attempt + 1
  where id = claimed
  returning *;
end $$;

-- ---------- atomi kreditműveletek ----------
-- Lefoglalás: egyszerre ellenőriz és von le; kevés fedezetnél hiba, nincs félállapot
create or replace function public.credit_hold(
  p_user uuid, p_job uuid, p_amount integer, p_key text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  new_balance integer;
begin
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;
  if exists (select 1 from public.credit_holds where idempotency_key = p_key) then
    return true; -- idempotens: már létezik
  end if;

  update public.credit_accounts
  set balance = balance - p_amount, updated_at = now()
  where user_id = p_user and balance >= p_amount
  returning balance into new_balance;

  if new_balance is null then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  insert into public.credit_holds (user_id, job_id, amount, idempotency_key)
  values (p_user, p_job, p_amount, p_key);

  insert into public.credit_transactions (user_id, hold_id, type, amount, balance_after, idempotency_key)
  select p_user, h.id, 'hold', -p_amount, new_balance, p_key || ':tx'
  from public.credit_holds h where h.idempotency_key = p_key;

  return true;
end $$;

-- Sikeres lezárás: a foglalást levonássá minősíti (különbözet-visszafizetés nélkül, becslés = végleges mocknál)
create or replace function public.credit_charge_hold(p_job uuid, p_key text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare h record;
begin
  select * into h from public.credit_holds where job_id = p_job and status = 'open' for update;
  if not found then
    if exists (select 1 from public.credit_holds where job_id = p_job and status = 'charged') then
      return true; -- idempotens
    end if;
    raise exception 'no open hold for job %', p_job;
  end if;
  update public.credit_holds set status = 'charged', resolved_at = now() where id = h.id;
  insert into public.credit_transactions (user_id, hold_id, type, amount, balance_after, idempotency_key, note)
  values (h.user_id, h.id, 'charge', 0,
          (select balance from public.credit_accounts where user_id = h.user_id),
          p_key, 'hold charged');
  return true;
end $$;

-- Hiba: pontosan egyszeri visszatérítés
create or replace function public.credit_refund_job(p_job uuid, p_key text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare h record; new_balance integer;
begin
  select * into h from public.credit_holds
  where job_id = p_job and status in ('open','charged') for update;
  if not found then
    if exists (select 1 from public.credit_holds where job_id = p_job and status = 'refunded') then
      return true; -- már visszatérítve (idempotens)
    end if;
    return false; -- nincs mit visszatéríteni
  end if;

  update public.credit_accounts
  set balance = balance + h.amount, updated_at = now()
  where user_id = h.user_id
  returning balance into new_balance;

  update public.credit_holds set status = 'refunded', resolved_at = now() where id = h.id;
  insert into public.credit_transactions (user_id, hold_id, type, amount, balance_after, idempotency_key, note)
  values (h.user_id, h.id, 'refund', h.amount, new_balance, p_key, 'automatic refund');
  return true;
end $$;

-- Admin jóváírás/levonás külön audit sorral
create or replace function public.credit_admin_adjust(
  p_user uuid, p_amount integer, p_admin uuid, p_note text, p_key text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare new_balance integer;
begin
  if not public.is_admin() and auth.uid() is not null then
    raise exception 'admin only';
  end if;
  if exists (select 1 from public.credit_transactions where idempotency_key = p_key) then
    return true;
  end if;
  update public.credit_accounts
  set balance = balance + p_amount, updated_at = now()
  where user_id = p_user and balance + p_amount >= 0
  returning balance into new_balance;
  if new_balance is null then raise exception 'adjustment would make balance negative'; end if;
  insert into public.credit_transactions (user_id, type, amount, balance_after, idempotency_key, note)
  values (p_user, 'admin_adjust', p_amount, new_balance, p_key, p_note);
  insert into public.admin_actions (admin_id, action, target_type, target_id, meta)
  values (p_admin, 'credit.adjust', 'user', p_user::text, jsonb_build_object('amount', p_amount, 'note', p_note));
  return true;
end $$;
