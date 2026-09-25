-- Castora 0.7.1: transactional Stripe fulfillment, explicit grants and plan RLS.
alter table public.plans enable row level security;
drop policy if exists "plans_public_read" on public.plans;
create policy "plans_public_read" on public.plans for select using (active = true or public.is_admin());

alter table public.payment_events add column if not exists signature_valid boolean not null default true;
alter table public.gallery_items add column if not exists project_id uuid references public.projects(id) on delete set null;

alter table public.generation_jobs drop constraint if exists generation_jobs_type_check;
alter table public.generation_jobs add constraint generation_jobs_type_check check (type in (
  'reference_qc','character_training','test_image','identity_check','image_generation','image_edit',
  'upscale','background_removal','skin_enhance','fix_face','pinterest_composition',
  'video_from_image','video_to_video','talking_video','character_swap','motion_control','lip_sync',
  'tts','video_to_prompt','captioning','frame_extract','dataset_generation','carousel_page',
  'viral_scene','ppv_render'
));

revoke all on public.plans, public.payment_events, public.credit_purchases from anon, authenticated;
grant select on public.plans to anon, authenticated;
grant select on public.credit_purchases to authenticated;
grant all on public.plans, public.payment_events, public.credit_purchases to service_role;

create or replace function public.process_stripe_event(
  p_event_id text, p_type text, p_payload jsonb, p_session_id text,
  p_user uuid, p_plan text
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_purchase public.credit_purchases%rowtype;
  v_credits integer;
  v_balance integer;
begin
  if exists (select 1 from public.payment_events where event_id = p_event_id) then
    return 'replay';
  end if;

  insert into public.payment_events(provider, event_id, type, payload, signature_valid)
  values ('stripe', p_event_id, p_type, p_payload, true);

  if p_type = 'checkout.session.completed' then
    if p_session_id is null or p_user is null or p_plan is null then
      raise exception 'INVALID_CHECKOUT_METADATA';
    end if;
    select * into v_purchase from public.credit_purchases
      where stripe_session_id = p_session_id for update;
    if not found or v_purchase.user_id <> p_user or v_purchase.plan_id <> p_plan then
      raise exception 'PURCHASE_NOT_FOUND_OR_MISMATCH';
    end if;
    if v_purchase.status = 'completed' then
      update public.payment_events set processed_at = now() where event_id = p_event_id;
      return 'replay';
    end if;
    if v_purchase.status <> 'pending' then raise exception 'PURCHASE_NOT_PENDING'; end if;
    select credits into v_credits from public.plans where id = p_plan and active = true;
    if v_credits is null or v_credits <> v_purchase.credits then raise exception 'PLAN_MISMATCH'; end if;

    update public.credit_accounts set balance = balance + v_credits
      where user_id = p_user returning balance into v_balance;
    if not found then raise exception 'CREDIT_ACCOUNT_NOT_FOUND'; end if;
    insert into public.credit_transactions
      (user_id, type, amount, balance_after, idempotency_key, note)
    values (p_user, 'purchase', v_credits, v_balance, 'stripe:' || p_session_id,
      'stripe purchase ' || p_plan);
    update public.credit_purchases set status = 'completed' where id = v_purchase.id;
  elsif p_type in ('checkout.session.async_payment_failed', 'checkout.session.expired')
        and p_session_id is not null then
    update public.credit_purchases set status = 'failed'
      where stripe_session_id = p_session_id and status = 'pending';
  end if;

  update public.payment_events set processed_at = now() where event_id = p_event_id;
  return 'processed';
end;
$$;
revoke execute on function public.process_stripe_event(text,text,jsonb,text,uuid,text) from public, anon, authenticated;
grant execute on function public.process_stripe_event(text,text,jsonb,text,uuid,text) to service_role;
