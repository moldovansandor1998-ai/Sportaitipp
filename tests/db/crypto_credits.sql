-- Rollback-only integration test: no real payment or permanent balance change.
begin;
do $$
declare a uuid; b uuid; o uuid; o2 uuid; units bigint; credits integer; before_balance integer; after_balance integer;
begin
  select id into a from public.profiles where email='moldovansandor1998@gmail.com';
  select id into b from public.profiles where role='user' limit 1;
  if a is null or b is null then raise exception 'Two existing accounts required'; end if;
  select balance into before_balance from public.credit_accounts where user_id=a;
  o := public.create_crypto_credit_order(a,'starter');
  if o <> public.create_crypto_credit_order(a,'starter') then raise exception 'Order creation not idempotent'; end if;
  o2 := public.create_crypto_credit_order(b,'starter');
  select amount_units,c.credits into units,credits from public.crypto_credit_orders c where id=o;
  if units=(select amount_units from public.crypto_credit_orders where id=o2) then raise exception 'Amount collision'; end if;
  begin
    perform public.complete_crypto_credit_order(o,b,repeat('a',64),units,'THMbEe1gpmyM96gY4VpNT6fHSf1HfbGwdY','TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',now());
    raise exception 'Cross-account payment accepted';
  exception when others then
    if sqlerrm <> 'ORDER_NOT_FOUND' then raise; end if;
  end;
  begin
    perform public.complete_crypto_credit_order(o,a,repeat('a',64),units-1,'THMbEe1gpmyM96gY4VpNT6fHSf1HfbGwdY','TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',now());
    raise exception 'Underpayment accepted';
  exception when others then
    if sqlerrm <> 'PROOF_MISMATCH' then raise; end if;
  end;
  perform public.complete_crypto_credit_order(o,a,repeat('a',64),units,'THMbEe1gpmyM96gY4VpNT6fHSf1HfbGwdY','TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',now());
  perform public.complete_crypto_credit_order(o,a,repeat('a',64),units,'THMbEe1gpmyM96gY4VpNT6fHSf1HfbGwdY','TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',now());
  select balance into after_balance from public.credit_accounts where user_id=a;
  if after_balance <> before_balance+credits then raise exception 'Double credit or missing credit'; end if;
  if (select count(*) from public.credit_transactions where idempotency_key='usdt-trc20:'||repeat('a',64))<>1 then raise exception 'Ledger replay'; end if;
  begin
    perform public.complete_crypto_credit_order(o2,b,repeat('a',64),(select amount_units from public.crypto_credit_orders where id=o2),'THMbEe1gpmyM96gY4VpNT6fHSf1HfbGwdY','TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',now());
    raise exception 'Cross-order replay accepted';
  exception when unique_violation then null; end;
end $$;
select set_config('request.jwt.claims', jsonb_build_object('sub',(select id from public.profiles where role='user' limit 1),'role','authenticated')::text,true);
set local role authenticated;
do $$
begin
  if exists(select 1 from public.characters where owner_id<>auth.uid()) then raise exception 'Foreign characters visible'; end if;
  if exists(select 1 from public.crypto_credit_orders where user_id<>auth.uid()) then raise exception 'Foreign orders visible'; end if;
  if has_function_privilege(current_user,'public.complete_crypto_credit_order(uuid,uuid,text,bigint,text,text,timestamptz)','execute') then raise exception 'Client can mint credits'; end if;
end $$;
select 'PASS: exact amounts, ownership, idempotent creation, atomic ledger, replay rejection and RLS; all changes rolled back' as verification;
rollback;
