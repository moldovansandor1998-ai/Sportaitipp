-- One-time USDT/TRC20 top-ups. Service-role functions validate immutable order
-- snapshots; visitors cannot mint credits, alter prices or submit chain evidence.
alter table public.plans add column if not exists price_usdt numeric(12,6);
update public.plans set price_usdt = case id when 'starter' then 15 when 'pro' then 65 when 'studio' then 180 end
where id in ('starter','pro','studio');

create sequence public.crypto_credit_invoice_nonce minvalue 1 maxvalue 99999 no cycle;
revoke all on sequence public.crypto_credit_invoice_nonce from public, anon, authenticated;
grant usage on sequence public.crypto_credit_invoice_nonce to service_role;

create table public.crypto_credit_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  plan_id text not null references public.plans(id),
  credits integer not null check (credits > 0),
  amount_units bigint not null unique check (amount_units > 0),
  recipient text not null check (recipient = 'THMbEe1gpmyM96gY4VpNT6fHSf1HfbGwdY'),
  status text not null default 'pending' check (status in ('pending','completed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  submitted_tx_hash text check (submitted_tx_hash ~ '^[a-f0-9]{64}$'),
  tx_hash text unique check (tx_hash ~ '^[a-f0-9]{64}$'),
  last_checked_at timestamptz,
  confirmed_at timestamptz,
  block_time timestamptz,
  check (expires_at > created_at),
  check ((status = 'pending' and tx_hash is null and confirmed_at is null)
    or (status = 'completed' and tx_hash is not null and confirmed_at is not null and block_time is not null))
);
create index crypto_orders_user_created on public.crypto_credit_orders(user_id,created_at desc);
alter table public.crypto_credit_orders enable row level security;
revoke all on public.crypto_credit_orders from public, anon, authenticated;
grant select on public.crypto_credit_orders to authenticated;
grant all on public.crypto_credit_orders to service_role;
create policy crypto_orders_own on public.crypto_credit_orders for select to authenticated
using (user_id = (select auth.uid()));

create function public.create_crypto_credit_order(p_user uuid, p_plan text) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_plan public.plans%rowtype; v_id uuid; v_nonce bigint;
begin
  -- Serializes double clicks and concurrent requests for this account.
  perform 1 from public.credit_accounts where user_id = p_user for update;
  if not found then raise exception 'CREDIT_ACCOUNT_NOT_FOUND'; end if;
  if not exists (select 1 from public.profiles where id=p_user and (banned_until is null or banned_until <= now()))
    then raise exception 'ACCOUNT_UNAVAILABLE'; end if;
  select id into v_id from public.crypto_credit_orders where user_id=p_user and plan_id=p_plan
    and status='pending' and expires_at > now() order by created_at desc limit 1;
  if found then return v_id; end if;
  if (select count(*) from public.crypto_credit_orders where user_id=p_user and created_at > now()-interval '1 day') >= 3
    then raise exception 'ORDER_RATE_LIMIT'; end if;
  select * into v_plan from public.plans where id=p_plan and active=true and price_usdt>0;
  if not found then raise exception 'PLAN_UNAVAILABLE'; end if;
  -- A tiny discount creates a permanently unique exact amount, never reused.
  -- This binds a public transaction to its original order even across accounts.
  v_nonce := nextval('public.crypto_credit_invoice_nonce');
  insert into public.crypto_credit_orders(user_id,plan_id,credits,amount_units,recipient)
  values(p_user,p_plan,v_plan.credits,(v_plan.price_usdt*1000000)::bigint-v_nonce,
    'THMbEe1gpmyM96gY4VpNT6fHSf1HfbGwdY') returning id into v_id;
  return v_id;
end $$;
revoke all on function public.create_crypto_credit_order(uuid,text) from public, anon, authenticated;
grant execute on function public.create_crypto_credit_order(uuid,text) to service_role;

create function public.complete_crypto_credit_order(p_order uuid,p_user uuid,p_tx text,p_amount bigint,
  p_recipient text,p_contract text,p_block_time timestamptz) returns text
language plpgsql security invoker set search_path = '' as $$
declare v_order public.crypto_credit_orders%rowtype; v_balance integer;
begin
  if p_tx is null or p_tx !~ '^[a-f0-9]{64}$' or p_amount is null or p_recipient is null or p_contract is null or p_block_time is null
    then raise exception 'INVALID_PROOF'; end if;
  select * into v_order from public.crypto_credit_orders where id=p_order and user_id=p_user for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status='completed' then
    if v_order.tx_hash=p_tx then return 'completed'; end if;
    raise exception 'ORDER_ALREADY_PAID';
  end if;
  if p_amount<>v_order.amount_units or p_recipient<>v_order.recipient
    or p_contract<>'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
    or p_block_time<v_order.created_at or p_block_time>v_order.expires_at
    then raise exception 'PROOF_MISMATCH'; end if;
  -- The unique tx_hash + ledger key reject replays atomically across all orders.
  update public.crypto_credit_orders set status='completed',tx_hash=p_tx,submitted_tx_hash=p_tx,
    block_time=p_block_time,confirmed_at=now() where id=p_order;
  update public.credit_accounts set balance=balance+v_order.credits,updated_at=now()
    where user_id=p_user returning balance into v_balance;
  if not found then raise exception 'CREDIT_ACCOUNT_NOT_FOUND'; end if;
  insert into public.credit_transactions(user_id,type,amount,balance_after,idempotency_key,note)
    values(p_user,'purchase',v_order.credits,v_balance,'usdt-trc20:'||p_tx,'USDT TRC20 '||v_order.plan_id);
  return 'completed';
end $$;
revoke all on function public.complete_crypto_credit_order(uuid,uuid,text,bigint,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.complete_crypto_credit_order(uuid,uuid,text,bigint,text,text,timestamptz) to service_role;
