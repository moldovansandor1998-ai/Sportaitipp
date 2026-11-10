-- Ephemeral focused fixture of the already-deployed legacy ledger contract only.
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create table auth.users(id uuid primary key, email_confirmed_at timestamptz, is_anonymous boolean default false);
create table public.profiles(id uuid primary key, banned_until timestamptz);
create table public.credit_accounts(user_id uuid primary key references public.profiles(id),balance integer not null check(balance>=0),updated_at timestamptz default now());
create table public.credit_transactions(id uuid primary key default gen_random_uuid(),user_id uuid references public.profiles(id),type text,amount integer,balance_after integer check(balance_after>=0),idempotency_key text unique,note text);
grant select on public.profiles to service_role;
grant select,update on public.credit_accounts to service_role;
grant select,insert on public.credit_transactions to service_role;
alter table auth.users enable row level security;
-- Match production: bypassrls is NOT a direct Auth SELECT grant.
revoke all on auth.users from service_role;
