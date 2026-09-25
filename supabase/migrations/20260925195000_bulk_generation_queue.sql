create table public.bulk_generation_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  batch_id uuid not null,
  character_id uuid not null references public.characters(id),
  asset_id uuid not null references public.assets(id),
  edit_model text not null check (edit_model in ('seedream-v4.5', 'nano-banana')),
  filename text not null,
  status text not null default 'pending' check (status in ('pending','claimed','started','failed')),
  job_id uuid references public.generation_jobs(id),
  error text,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (batch_id, asset_id)
);
create index bulk_generation_pending_idx on public.bulk_generation_items (status, created_at);
create index bulk_generation_owner_idx on public.bulk_generation_items (owner_id, created_at desc);
alter table public.bulk_generation_items enable row level security;
create policy bulk_generation_read on public.bulk_generation_items for select to authenticated using (owner_id = auth.uid());
revoke all on public.bulk_generation_items from anon, authenticated;
grant select on public.bulk_generation_items to authenticated;

create or replace function public.claim_bulk_generation_item()
returns setof public.bulk_generation_items language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from public.bulk_generation_items
  where status = 'pending' or (status = 'claimed' and claimed_at < now() - interval '10 minutes')
  order by created_at limit 1 for update skip locked;
  if v_id is null then return; end if;
  return query update public.bulk_generation_items
    set status='claimed', claimed_at=now() where id=v_id returning *;
end $$;
revoke execute on function public.claim_bulk_generation_item() from public, anon, authenticated;
grant execute on function public.claim_bulk_generation_item() to service_role;
