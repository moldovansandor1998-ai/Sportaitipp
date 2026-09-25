-- Kétfelhasználós RLS- és privilégium-teszt (helyi Supabase-en, psql-lel fut)
\set ON_ERROR_STOP on

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'userA@test.hu', '', now(), now())
on conflict (id) do nothing;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'userB@test.hu', '', now(), now())
on conflict (id) do nothing;

-- ======== USER A: explicit tranzakció, tranzakció-szintű claim ========
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","email":"userA@test.hu"}', true);

insert into public.characters (owner_id, name)
values ('11111111-1111-1111-1111-111111111111', 'A-karakter')
on conflict do nothing;

do $$
begin
  if exists (select 1 from public.characters where owner_id = '22222222-2222-2222-2222-222222222222') then
    raise exception 'RLS BREACH: A látja B karakterét';
  end if;
  if exists (select 1 from public.credit_accounts where user_id = '22222222-2222-2222-2222-222222222222') then
    raise exception 'RLS BREACH: A látja B kreditszámláját';
  end if;
  begin
    update public.characters set status = 'active' where owner_id = '11111111-1111-1111-1111-111111111111';
    raise exception 'PRIV BREACH: characters.status kliensről módosítható';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.characters set active_version_id = gen_random_uuid() where owner_id = '11111111-1111-1111-1111-111111111111';
    raise exception 'PRIV BREACH: active_version_id kliensről módosítható';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'PRIV BREACH: profiles.role kliensről módosítható';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set age_verified_at = now() where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'PRIV BREACH: age_verified_at kliensről módosítható';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set banned_until = now() where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'PRIV BREACH: banned_until kliensről módosítható';
  exception when insufficient_privilege then null;
  end;
end $$;
commit;

-- ======== USER B ========
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","email":"userB@test.hu"}', true);

do $$
begin
  if exists (select 1 from public.characters where owner_id = '11111111-1111-1111-1111-111111111111') then
    raise exception 'RLS BREACH: B látja A karakterét';
  end if;
  if exists (select 1 from public.gallery_items where owner_id = '11111111-1111-1111-1111-111111111111') then
    raise exception 'RLS BREACH: B látja A galériáját';
  end if;
  if not exists (select 1 from public.credit_accounts where user_id = '22222222-2222-2222-2222-222222222222') then
    raise exception 'RLS HIBA: B nem látja a saját kreditszámláját';
  end if;
  -- B idegen rekordjára a UPDATE helyes RLS mellett 0 sort módosít (nem feltétlenül dob)
  update public.characters set name = 'B-probalja' where owner_id = '11111111-1111-1111-1111-111111111111';
  if found then
    raise exception 'RLS BREACH: B módosította A karakterét';
  end if;
end $$;
commit;

select 'RLS_TEST_PASSED' as result;
