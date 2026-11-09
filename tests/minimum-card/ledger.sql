begin;
insert into auth.users values('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',now(),false),('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',now(),false);
insert into public.profiles(id) select id from auth.users;
insert into public.credit_accounts(user_id,balance) select id,100 from auth.users;
set local role service_role;
do $$ begin
  begin
    perform id from auth.users limit 1;
    raise exception 'Direct Auth read unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  if public.whop_card_begin('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',repeat('a',64),'plan_test','biz_test','prod_test','usd',29,2000)<>repeat('a',64)
    then raise exception 'Service-only identity constructor failed'; end if;
end $$;
reset role;
select public.whop_card_begin('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',repeat('a',64),'plan_test','biz_test','prod_test','usd',29,2000);
select public.whop_card_checkout_saved(repeat('a',64),'ch_test');
select public.whop_card_receive('evt_1','payment.succeeded','biz_test','pay_test',now());
do $$ declare r text; begin
  -- Server retry reuses one durable checkout identity, even with a new random token.
  if public.whop_card_begin('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',repeat('c',64),'plan_test','biz_test','prod_test','usd',29,2000)<>repeat('a',64) then raise exception 'Checkout retry duplicated'; end if;
  begin
    perform public.whop_card_begin('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',repeat('c',64),'plan_other','biz_test','prod_other','usd',49,4000);
    raise exception 'Unexpected allowed second checkout';
  exception when others then if sqlerrm='Unexpected allowed second checkout' then raise; end if; end;
  -- Forged checkout association cannot grant; event remains pending for real proof.
  begin
    perform public.whop_card_grant('evt_1','pay_test','mem_test','user_test','plan_test','biz_test','prod_test','usd',29,2000,repeat('a',64),'ch_wrong',now(),now()+interval '29 days',true,now());
    raise exception 'Unexpected forged binding grant';
  exception when others then if sqlerrm='Unexpected forged binding grant' then raise; end if; end;
  if (select status from public.whop_card_events where event_id='evt_1')<>'pending' then raise exception 'Failed evidence acknowledged'; end if;
  r:=public.whop_card_grant('evt_1','pay_test','mem_test','user_test','plan_test','biz_test','prod_test','usd',29,2000,repeat('a',64),'ch_test',now(),now()+interval '29 days',true,now());
  if r<>'credited' then raise exception 'First grant missing'; end if;
  if (select balance from public.credit_accounts where user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')<>2100 then raise exception 'Legacy balance not preserved'; end if;
  perform public.whop_card_grant('evt_1','pay_test','mem_test','user_test','plan_test','biz_test','prod_test','usd',29,2000,null,null,now(),now()+interval '29 days',true,now());
  perform public.whop_card_receive('evt_replay','payment.succeeded','biz_test','pay_test',now());
  r:=public.whop_card_grant('evt_replay','pay_test','mem_test','user_test','plan_test','biz_test','prod_test','usd',29,2000,null,null,now(),now()+interval '29 days',true,now());
  if r<>'duplicate' or (select count(*) from public.credit_transactions)<>1 then raise exception 'Replay duplicated grant'; end if;
  perform public.whop_card_receive('evt_overlapping','payment.succeeded','biz_test','pay_other',now());
  r:=public.whop_card_grant('evt_overlapping','pay_other','mem_test','user_test','plan_test','biz_test','prod_test','usd',29,2000,null,null,now(),now()+interval '29 days',true,now());
  if r<>'credited' or (select count(*) from public.credit_transactions)<>2 then raise exception 'Distinct paid receipt stranded'; end if;
  -- The same hosted URL is reusable: a second genuine purchase/membership
  -- still belongs to the original immutable destination, not the payer's email.
  perform public.whop_card_receive('evt_reuse','payment.succeeded','biz_test','pay_reuse',now());
  r:=public.whop_card_grant('evt_reuse','pay_reuse','mem_reuse','user_other','plan_test','biz_test','prod_test','usd',29,2000,repeat('a',64),'ch_test',now(),now()+interval '29 days',true,now());
  if r<>'credited' or (select balance from public.credit_accounts where user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')<>6100
    or (select count(*) from public.whop_card_memberships where binding_token=repeat('a',64))<>2 then raise exception 'Reused hosted checkout stranded'; end if;
  -- A delayed old payment remains fulfillable; current cancellation is preserved.
  update public.whop_card_bindings set created_at=now()-interval '100 days' where binding_token=repeat('a',64);
  perform public.whop_card_receive('evt_delayed','payment.succeeded','biz_test','pay_delayed',now());
  r:=public.whop_card_grant('evt_delayed','pay_delayed','mem_test','user_test','plan_test','biz_test','prod_test','usd',29,2000,null,null,now()-interval '60 days',null,false,now());
  if r<>'credited' or (select active from public.whop_card_memberships where membership_id='mem_test') then raise exception 'Delayed payment stranded or canceled membership reactivated'; end if;
  -- Paid discounts are durable operator review, not lost in an endless retry or silently partial credits.
  perform public.whop_card_receive('evt_discount','payment.succeeded','biz_test','pay_discount',now());
  r:=public.whop_card_grant('evt_discount','pay_discount','mem_discount','user_test','plan_test','biz_test','prod_test','usd',29,2000,repeat('a',64),'ch_test',now(),now()+interval '29 days',true,now(),'discounted_receipt',20);
  if r<>'review' or (select status from public.whop_card_events where event_id='evt_discount')<>'review'
    or (select balance from public.credit_accounts where user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')<>8100
    or not exists(select 1 from public.whop_card_reviews where payment_id='pay_discount' and binding_token=repeat('a',64) and paid_base=20)
    or not exists(select 1 from public.whop_card_memberships where membership_id='mem_discount') then raise exception 'Discount resolution lost'; end if;
  -- A second user starts a different checkout, but cannot steal first user's membership.
  perform public.whop_card_begin('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',repeat('b',64),'plan_test','biz_test','prod_test','usd',29,2000);
  perform public.whop_card_checkout_saved(repeat('b',64),'ch_second');
  perform public.whop_card_receive('evt_stolen','payment.succeeded','biz_test','pay_stolen',now());
  begin
    perform public.whop_card_grant('evt_stolen','pay_stolen','mem_test','user_other','plan_test','biz_test','prod_test','usd',29,2000,repeat('b',64),'ch_second',now(),now()+interval '29 days',true,now());
    raise exception 'Unexpected identity reassignment';
  exception when others then if sqlerrm='Unexpected identity reassignment' then raise; end if; end;
  -- Simulate a ledger write failure: no membership, payment, balance or event is committed.
  insert into public.credit_transactions(user_id,type,amount,balance_after,idempotency_key) values('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','purchase',0,100,'whop-card:pay_atomic');
  perform public.whop_card_receive('evt_atomic','payment.succeeded','biz_test','pay_atomic',now());
  begin
    perform public.whop_card_grant('evt_atomic','pay_atomic','mem_second','user_second','plan_test','biz_test','prod_test','usd',29,2000,repeat('b',64),'ch_second',now(),now()+interval '29 days',true,now());
    raise exception 'Unexpected failed-ledger grant';
  exception when unique_violation then null; end;
  if exists(select 1 from public.whop_card_payments where payment_id='pay_atomic')
    or exists(select 1 from public.whop_card_memberships where membership_id='mem_second')
    or (select balance from public.credit_accounts where user_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')<>100
    or (select status from public.whop_card_events where event_id='evt_atomic')<>'pending' then raise exception 'Atomic grant leaked'; end if;
  delete from public.credit_transactions where idempotency_key='whop-card:pay_atomic';
  -- Reversal-before-payment records a tombstone without touching money or credits.
  perform public.whop_card_receive('evt_refund','refund.created','biz_test','rf_test',now());
  perform public.whop_card_review('evt_refund','pay_atomic','mem_second','user_second','plan_test','provider_refund');
  r:=public.whop_card_grant('evt_atomic','pay_atomic','mem_second','user_second','plan_test','biz_test','prod_test','usd',29,2000,repeat('b',64),'ch_second',now(),now()+interval '29 days',true,now());
  if r<>'review' or (select balance from public.credit_accounts where user_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')<>100 then raise exception 'Reversal granted or debited'; end if;
  if has_function_privilege('authenticated','public.whop_card_grant(text,text,text,text,text,text,text,text,numeric,integer,text,text,timestamptz,timestamptz,boolean,timestamptz,text,numeric)','EXECUTE') then raise exception 'Client can grant credits'; end if;
  if has_function_privilege('authenticated','public.whop_card_begin(uuid,text,text,text,text,text,numeric,integer)','EXECUTE')
    or has_function_privilege('anon','public.whop_card_begin(uuid,text,text,text,text,text,numeric,integer)','EXECUTE')
    or has_table_privilege('service_role','auth.users','SELECT') then raise exception 'Identity privilege widened'; end if;
end $$;
rollback;
