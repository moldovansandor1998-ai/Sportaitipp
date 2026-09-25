-- ============================================================
-- Castora 0005 – további biztonsági és konzisztencia-javítások
-- ============================================================

-- ---------- 1) claim_job: ROW_COUNT integer változóba ----------
create or replace function public.claim_job(p_job uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare affected integer;
begin
  update public.generation_jobs
  set status = 'submitted', attempt = attempt + 1, started_at = now()
  where id = p_job and status = 'queued';
  get diagnostics affected = row_count;
  return affected > 0;
end $$;

revoke execute on function public.claim_job(uuid) from public, anon, authenticated;
grant execute on function public.claim_job(uuid) to service_role;

-- ---------- 2) Karakter-állapotgép (adatbázis-kényszer) ----------
create table public.character_status_rules (
  from_status text not null,
  to_status text not null,
  primary key (from_status, to_status)
);

insert into public.character_status_rules (from_status, to_status) values
  ('draft','collecting_refs'), ('draft','archived'),
  ('collecting_refs','refs_qc'), ('collecting_refs','archived'),
  ('refs_qc','ready_to_train'), ('refs_qc','collecting_refs'), ('refs_qc','archived'),
  ('ready_to_train','training'), ('ready_to_train','archived'),
  ('training','test_pending'), ('training','failed'), ('training','archived'),
  ('test_pending','active'), ('test_pending','training'), ('test_pending','archived'),
  ('active','training'), ('active','archived'),
  ('rejected','collecting_refs'), ('rejected','archived'),
  ('failed','collecting_refs'), ('failed','archived');

create or replace function public.enforce_character_transition() returns trigger
language plpgsql as $$
begin
  if old.status = new.status then return new; end if;
  if not exists (select 1 from public.character_status_rules
                 where from_status = old.status and to_status = new.status) then
    raise exception 'illegal character transition: % → %', old.status, new.status;
  end if;
  return new;
end $$;

create trigger trg_character_transition before update on public.characters
  for each row execute function public.enforce_character_transition();

-- ---------- 3) Kliens ne írhassa a szervervezérelt karaktermezőket ----------
revoke update (status, active_version_id, consent_type, consent_document_asset_id) on public.characters from anon, authenticated;
grant update (name, description, is_spicy) on public.characters to authenticated;

-- ---------- 4) profiles érzékeny mezői ----------
revoke update on public.profiles from anon, authenticated;

-- ---------- 5) credit_admin_adjust: az átadott admin azonosítót validálja ----------
-- (a függvényt csak service role hívhatja – EXECUTE jog revoke-olva –,
--  a hitelesítés az /api/admin/credits végponton történik, itt p_admin ellenőrzés)
create or replace function public.credit_admin_adjust(
  p_user uuid, p_amount integer, p_admin uuid, p_note text, p_key text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare new_balance integer;
begin
  if not exists (select 1 from public.profiles where id = p_admin and role = 'admin') then
    raise exception 'invalid admin';
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

revoke execute on function public.credit_admin_adjust(uuid, integer, uuid, text, text) from public, anon, authenticated;
grant execute on function public.credit_admin_adjust(uuid, integer, uuid, text, text) to service_role;

-- ---------- 6) Galéria soft-delete (retryzható törlés) ----------
alter table public.gallery_items add column deleted_at timestamptz;
create index idx_gallery_deleted on public.gallery_items(deleted_at) where deleted_at is null;
