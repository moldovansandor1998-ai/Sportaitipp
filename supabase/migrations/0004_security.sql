-- ============================================================
-- Castora 0004 – biztonsági javítások
-- ============================================================

-- ---------- 1) SECURITY DEFINER függvények védelme ----------
-- Csak service role hívhatja őket (server-oldal). Az is_admin() KIVÉTEL:
-- azt RLS-policyk használják authenticated szerepkörben is.
revoke execute on function public.credit_hold(uuid, uuid, integer, text) from public, anon, authenticated;
revoke execute on function public.credit_charge_hold(uuid, text) from public, anon, authenticated;
revoke execute on function public.credit_refund_job(uuid, text) from public, anon, authenticated;
revoke execute on function public.credit_admin_adjust(uuid, integer, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.claim_next_job() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.enforce_job_transition() from public, anon, authenticated;
revoke execute on function public.log_job_event() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

grant execute on function public.credit_hold(uuid, uuid, integer, text) to service_role;
grant execute on function public.credit_charge_hold(uuid, text) to service_role;
grant execute on function public.credit_refund_job(uuid, text) to service_role;
grant execute on function public.credit_admin_adjust(uuid, integer, uuid, text, text) to service_role;
grant execute on function public.claim_next_job() to service_role;

-- ---------- 2) credit_admin_adjust: auth.uid() = null SOHA nem járhat adminjoggal ----------
create or replace function public.credit_admin_adjust(
  p_user uuid, p_amount integer, p_admin uuid, p_note text, p_key text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare new_balance integer;
begin
  if not public.is_admin() then
    raise exception 'admin only';  -- auth.uid() null-lal az is_admin() false → tiltott
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

-- ---------- 3) Felhasználó ne írhassa közvetlenül a védett mezőket ----------
-- A kliens sosem UPDATE-ol jobot (a feldolgozás service role-lal megy) –
-- a jogosultságot oszlopszinten vonjuk meg. (A service_role ezt nem érinti.)
revoke insert, update, delete on public.generation_jobs from anon, authenticated;
revoke insert, update, delete on public.generation_job_events from anon, authenticated;
revoke insert, update, delete on public.provider_requests from anon, authenticated;
revoke insert, update, delete on public.credit_accounts from anon, authenticated;
revoke insert, update, delete on public.credit_holds from anon, authenticated;
revoke insert, update, delete on public.credit_transactions from anon, authenticated;
revoke insert, update, delete on public.character_versions from anon, authenticated;
revoke insert, update, delete on public.email_events from anon, authenticated;
revoke insert, update, delete on public.webhook_events from anon, authenticated;
revoke insert, update, delete on public.audit_logs from anon, authenticated;
revoke insert, update, delete on public.admin_actions from anon, authenticated;
revoke insert, update, delete on public.moderation_flags from anon, authenticated;

-- ---------- 4) Konkrét job claim (egy feldolgozó, atomi) ----------
create or replace function public.claim_job(p_job uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  update public.generation_jobs
  set status = 'submitted', attempt = attempt + 1, started_at = now()
  where id = p_job and status = 'queued';
  get diagnostics ok = row_count;
  return ok > 0;
end $$;

revoke execute on function public.claim_job(uuid) from public, anon, authenticated;
grant execute on function public.claim_job(uuid) to service_role;

-- ---------- 5) Job-létrehozás + kredithold EGyetlen tranzakcióban ----------
create or replace function public.create_job_with_hold(
  p_owner uuid, p_type text, p_character uuid, p_project uuid,
  p_payload jsonb, p_key text, p_estimated integer
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_job uuid;
begin
  -- Tulajdon-ellenőrzés: más karakterére/projektjére nem indítható job
  if p_character is not null and not exists
    (select 1 from public.characters where id = p_character and owner_id = p_owner) then
    raise exception 'CHARACTER_NOT_OWNED';
  end if;
  if p_project is not null and not exists
    (select 1 from public.projects where id = p_project and owner_id = p_owner) then
    raise exception 'PROJECT_NOT_OWNED';
  end if;
  -- Generálás csak aktív karakterrel
  if p_character is not null and p_type in
    ('image_generation','image_edit','video_from_image','talking_video','character_swap','motion_control') then
    if not exists (select 1 from public.characters where id = p_character and status = 'active') then
      raise exception 'CHARACTER_NOT_ACTIVE';
    end if;
  end if;

  insert into public.generation_jobs (owner_id, type, character_id, project_id, payload,
                                      status, cost_estimate, idempotency_key)
  values (p_owner, p_type, p_character, p_project, p_payload,
          'awaiting_credit', p_estimated, p_key)
  returning id into v_job;

  -- Ha ez kivételt dob (kevés kredit), a teljes tranzakció visszagörget – árva job nincs
  perform public.credit_hold(p_owner, v_job, p_estimated, 'hold:' || v_job);

  update public.generation_jobs set status = 'queued' where id = v_job;
  return v_job;
end $$;

revoke execute on function public.create_job_with_hold(uuid, text, uuid, uuid, jsonb, text, integer) from public, anon, authenticated;
grant execute on function public.create_job_with_hold(uuid, text, uuid, uuid, jsonb, text, integer) to service_role;
