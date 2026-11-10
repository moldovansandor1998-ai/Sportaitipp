begin;
-- Additive existing-customer billing only. Does not change signup, RLS on existing
-- tables, balances, job prices, access rules, or provider dispatch.
create table public.whop_card_bindings (
  binding_token text primary key check (binding_token ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references public.profiles(id),
  plan_id text not null, account_id text not null, product_id text not null,
  currency text not null check(currency='usd'), base_price numeric(10,2) not null,
  credits integer not null,
  checkout_id text unique, created_at timestamptz not null default now(),
  -- First completed membership closes local admission; the hosted link itself is reusable.
  membership_id text unique,
  check ((base_price=29 and credits=2000) or (base_price=49 and credits=4000) or (base_price=99 and credits=9000))
);
create unique index whop_card_one_pending on public.whop_card_bindings(user_id) where membership_id is null;
create table public.whop_card_memberships (
  membership_id text primary key,
  binding_token text not null references public.whop_card_bindings(binding_token),
  whop_user_id text not null, active boolean not null,
  paid_through timestamptz, observed_at timestamptz not null
);
create table public.whop_card_events (
  event_id text primary key, event_type text not null, account_id text not null,
  resource_id text not null, event_timestamp timestamptz not null,
  status text not null default 'pending' check(status in ('pending','processed','review')),
  attempts integer not null default 0, created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index whop_card_pending_events on public.whop_card_events(created_at) where status='pending';
create table public.whop_card_payments (
  payment_id text primary key, membership_id text not null references public.whop_card_memberships(membership_id),
  paid_at timestamptz not null,
  credits integer not null check(credits>0), created_at timestamptz not null default now()
);
create table public.whop_card_reviews (
  payment_id text primary key, membership_id text not null, plan_id text not null,
  whop_user_id text not null, reason text not null,
  created_at timestamptz not null default now(),
  binding_token text references public.whop_card_bindings(binding_token),
  paid_base numeric(10,2), currency text
);
-- Server-only normalized payment evidence. No emails, signing secrets or bearer tokens.
do $$ declare t text; begin
  foreach t in array array['whop_card_bindings','whop_card_memberships','whop_card_events','whop_card_payments','whop_card_reviews'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public,anon,authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

create function public.whop_card_begin(p_user uuid,p_token text,p_plan text,p_account text,p_product text,p_currency text,p_base numeric,p_credits integer)
-- Supabase service_role cannot SELECT auth.users directly. This sole definer
-- constructor checks one server-authenticated identity and returns only its opaque
-- checkout binding. EXECUTE is revoked from public/anon/authenticated below;
-- no Auth-table privilege, existing RLS policy or role is broadened.
returns text language plpgsql security definer set search_path='' as $$
declare b public.whop_card_bindings%rowtype;
begin
  perform 1 from public.credit_accounts where user_id=p_user for update;
  if not found then raise exception 'CREDIT_ACCOUNT_NOT_FOUND'; end if;
  if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=p_user
    and u.email_confirmed_at is not null and coalesce(u.is_anonymous,false)=false
    and (p.banned_until is null or p.banned_until<=now())) then raise exception 'ACCOUNT_UNAVAILABLE'; end if;
  if exists(select 1 from public.whop_card_memberships m join public.whop_card_bindings x using(binding_token)
    where x.user_id=p_user and (m.active or m.paid_through>now())) then raise exception 'SUBSCRIPTION_EXISTS'; end if;
  if exists(select 1 from public.whop_card_reviews r join public.whop_card_memberships m using(membership_id)
    join public.whop_card_bindings x on x.binding_token=m.binding_token where x.user_id=p_user) then raise exception 'PAYMENT_REVIEW'; end if;
  select * into b from public.whop_card_bindings where user_id=p_user and membership_id is null;
  if found then
    if b.plan_id<>p_plan or b.account_id<>p_account or b.product_id<>p_product or b.currency<>p_currency
      or b.base_price<>p_base or b.credits<>p_credits then raise exception 'UNRESOLVED_CHECKOUT'; end if;
    return b.binding_token; -- Never expire unresolved hosted checkouts or start a second charge.
  end if;
  insert into public.whop_card_bindings(binding_token,user_id,plan_id,account_id,product_id,currency,base_price,credits)
    values(p_token,p_user,p_plan,p_account,p_product,p_currency,p_base,p_credits);
  return p_token;
end $$;

create function public.whop_card_checkout_saved(p_token text,p_checkout text) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  update public.whop_card_bindings set checkout_id=p_checkout where binding_token=p_token
    and (checkout_id is null or checkout_id=p_checkout);
  if not found then raise exception 'CHECKOUT_MISMATCH'; end if;
  return true;
end $$;

create function public.whop_card_receive(p_event text,p_type text,p_account text,p_resource text,p_at timestamptz)
returns text language plpgsql security invoker set search_path='' as $$
declare e public.whop_card_events%rowtype;
begin
  if length(p_event)>128 or length(p_resource)>128 or p_type not in
    ('payment.succeeded','membership.updated','membership.activated','refund.created','refund.updated','dispute.created','dispute.updated')
    then raise exception 'INVALID_EVENT'; end if;
  insert into public.whop_card_events(event_id,event_type,account_id,resource_id,event_timestamp)
    values(p_event,p_type,p_account,p_resource,p_at) on conflict(event_id) do nothing;
  select * into e from public.whop_card_events where event_id=p_event for update;
  if e.event_type<>p_type or e.account_id<>p_account or e.resource_id<>p_resource or e.event_timestamp<>p_at then raise exception 'EVENT_MISMATCH'; end if;
  return e.status;
end $$;

create function public.whop_card_grant(p_event text,p_payment text,p_membership text,p_whop_user text,p_plan text,
 p_account text,p_product text,p_currency text,p_base numeric,p_credits integer,p_binding text,p_checkout text,
 p_paid timestamptz,p_through timestamptz,p_active boolean,p_observed timestamptz,
 p_review_reason text default null,p_paid_base numeric default null)
returns text language plpgsql security invoker set search_path='' as $$
declare e public.whop_card_events%rowtype; b public.whop_card_bindings%rowtype;
 m public.whop_card_memberships%rowtype; old public.whop_card_payments%rowtype; v_balance integer;
begin
  select * into e from public.whop_card_events where event_id=p_event for update;
  if not found or e.event_type<>'payment.succeeded' or e.resource_id<>p_payment or e.account_id<>p_account then raise exception 'EVENT_MISMATCH'; end if;
  if e.status<>'pending' then return e.status; end if;
  perform pg_advisory_xact_lock(hashtextextended('whop-card-payment:'||p_payment,0));
  perform pg_advisory_xact_lock(hashtextextended('whop-card-membership:'||p_membership,0));
  if p_review_reason is not null and p_review_reason<>'discounted_receipt' then raise exception 'INVALID_REVIEW_REASON'; end if;
  if p_review_reason='discounted_receipt' and (p_paid_base is null or p_paid_base<0 or p_paid_base>=p_base) then raise exception 'INVALID_DISCOUNT'; end if;
  if p_paid is null or p_observed is null or p_active is null or p_paid>now() then raise exception 'INVALID_RECEIPT_TIME'; end if;
  select x.* into b from public.whop_card_bindings x join public.whop_card_memberships y using(binding_token) where y.membership_id=p_membership;
  if not found then
    select * into b from public.whop_card_bindings where binding_token=p_binding and checkout_id=p_checkout;
    if not found then raise exception 'BINDING_MISMATCH'; end if;
  end if;
  perform 1 from public.credit_accounts where user_id=b.user_id for update;
  if not found then raise exception 'CREDIT_ACCOUNT_NOT_FOUND'; end if;
  select * into b from public.whop_card_bindings where binding_token=b.binding_token for update;
  if b.plan_id<>p_plan or b.account_id<>p_account or b.product_id<>p_product or b.currency<>p_currency
    or b.base_price<>p_base or b.credits<>p_credits or p_paid<b.created_at
    or (p_binding is not null and p_binding<>b.binding_token)
    or (p_checkout is not null and p_checkout<>b.checkout_id) then raise exception 'BINDING_MISMATCH'; end if;
  select * into m from public.whop_card_memberships where membership_id=p_membership;
  if found and (m.binding_token<>b.binding_token or m.whop_user_id<>p_whop_user) then raise exception 'MEMBERSHIP_MISMATCH'; end if;
  if exists(select 1 from public.whop_card_reviews where payment_id=p_payment) then
    update public.whop_card_events set status='review',completed_at=now() where event_id=p_event;
    return 'review';
  end if;
  select * into old from public.whop_card_payments where payment_id=p_payment;
  if found then
    if old.membership_id<>p_membership or old.paid_at<>p_paid or old.credits<>p_credits then raise exception 'PAYMENT_MISMATCH'; end if;
    update public.whop_card_events set status='processed',completed_at=now() where event_id=p_event;
    return 'duplicate';
  end if;
  -- Distinct successful receipts are distinct purchases, even if a hosted link
  -- was reused or the current membership period overlaps. Never confuse them
  -- with replay. Every receipt keeps this binding's original app destination.
  insert into public.whop_card_memberships(membership_id,binding_token,whop_user_id,active,paid_through,observed_at)
    values(p_membership,b.binding_token,p_whop_user,p_active,p_through,p_observed)
    on conflict(membership_id) do update set paid_through=greatest(public.whop_card_memberships.paid_through,excluded.paid_through),
      active=case when excluded.observed_at>=public.whop_card_memberships.observed_at then excluded.active else public.whop_card_memberships.active end,
      observed_at=greatest(public.whop_card_memberships.observed_at,excluded.observed_at);
  update public.whop_card_bindings set membership_id=coalesce(membership_id,p_membership) where binding_token=b.binding_token;
  if p_review_reason is not null then
    insert into public.whop_card_reviews(payment_id,membership_id,plan_id,whop_user_id,reason,binding_token,paid_base,currency)
      values(p_payment,p_membership,p_plan,p_whop_user,p_review_reason,b.binding_token,p_paid_base,p_currency) on conflict do nothing;
    update public.whop_card_events set status='review',completed_at=now() where event_id=p_event;
    return 'review'; -- A real discounted charge needs an explicit entitlement/refund decision, never endless retry.
  end if;
  insert into public.whop_card_payments(payment_id,membership_id,paid_at,credits) values(p_payment,p_membership,p_paid,p_credits);
  update public.credit_accounts set balance=balance+p_credits,updated_at=now() where user_id=b.user_id returning balance into v_balance;
  insert into public.credit_transactions(user_id,type,amount,balance_after,idempotency_key,note)
    values(b.user_id,'purchase',p_credits,v_balance,'whop-card:'||p_payment,'Whop recurring credits');
  update public.whop_card_events set status='processed',completed_at=now() where event_id=p_event;
  return 'credited';
end $$;

create function public.whop_card_review(p_event text,p_payment text,p_membership text,p_whop_user text,p_plan text,p_reason text)
returns text language plpgsql security invoker set search_path='' as $$
declare e public.whop_card_events%rowtype; b public.whop_card_bindings%rowtype; m public.whop_card_memberships%rowtype;
begin
  select * into e from public.whop_card_events where event_id=p_event for update;
  if not found or e.event_type not in ('refund.created','refund.updated','dispute.created','dispute.updated') then raise exception 'EVENT_MISMATCH'; end if;
  if e.status<>'pending' then return e.status; end if;
  perform pg_advisory_xact_lock(hashtextextended('whop-card-payment:'||p_payment,0));
  select * into m from public.whop_card_memberships where membership_id=p_membership;
  if found then
    select * into b from public.whop_card_bindings where binding_token=m.binding_token;
    if b.plan_id<>p_plan or b.account_id<>e.account_id or m.whop_user_id<>p_whop_user then raise exception 'MEMBERSHIP_MISMATCH'; end if;
  end if;
  insert into public.whop_card_reviews(payment_id,membership_id,plan_id,whop_user_id,reason,created_at) values(p_payment,p_membership,p_plan,p_whop_user,p_reason,now()) on conflict do nothing;
  -- Deliberately no debit, refund, fund transfer or access revocation.
  update public.whop_card_events set status='review',completed_at=now() where event_id=p_event;
  return 'review';
end $$;

create function public.whop_card_membership_event(p_event text,p_membership text,p_whop_user text,p_plan text,p_active boolean,p_observed timestamptz)
returns text language plpgsql security invoker set search_path='' as $$
declare e public.whop_card_events%rowtype; b public.whop_card_bindings%rowtype; m public.whop_card_memberships%rowtype;
begin
  select * into e from public.whop_card_events where event_id=p_event for update;
  if not found or e.event_type not in ('membership.updated','membership.activated') or e.resource_id<>p_membership then raise exception 'EVENT_MISMATCH'; end if;
  select * into m from public.whop_card_memberships where membership_id=p_membership for update;
  if found then
    select * into b from public.whop_card_bindings where binding_token=m.binding_token;
    if b.plan_id<>p_plan or b.account_id<>e.account_id or m.whop_user_id<>p_whop_user then raise exception 'MEMBERSHIP_MISMATCH'; end if;
    update public.whop_card_memberships set active=p_active,observed_at=p_observed
      where membership_id=p_membership and observed_at<=p_observed;
  end if;
  update public.whop_card_events set status='processed',completed_at=now() where event_id=p_event;
  return 'processed'; -- Membership activity never grants credits.
end $$;

do $$ declare f regprocedure; begin
  for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname like 'whop_card_%' loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;

commit;
