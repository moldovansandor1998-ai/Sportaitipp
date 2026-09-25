-- Kreditcsomagok + Stripe-tranzakciók
create table if not exists public.plans (
  id text primary key,
  name text not null,
  credits integer not null,
  price_huf integer not null,
  active boolean not null default true
);
insert into public.plans (id, name, credits, price_huf) values
  ('starter', 'Starter', 1000, 4900),
  ('pro', 'Pro', 5000, 19900),
  ('studio', 'Studio', 15000, 49900)
on conflict (id) do nothing;

create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null unique,
  type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.credit_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_id text not null references public.plans(id),
  credits integer not null,
  amount_huf integer not null,
  status text not null default 'completed' check (status in ('pending','completed','failed','refunded')),
  stripe_session_id text unique,
  created_at timestamptz not null default now()
);
alter table public.credit_purchases enable row level security;
create policy "purchases_own" on public.credit_purchases for select using (user_id = auth.uid());
alter table public.payment_events enable row level security;
create policy "payment_events_admin" on public.payment_events for select using (public.is_admin());
