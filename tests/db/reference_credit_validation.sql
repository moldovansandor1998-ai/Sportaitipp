begin;
insert into auth.users(id,email) values('aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa','reference-validation@example.invalid');
update public.credit_accounts set balance=200 where user_id='aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa';
insert into public.characters(id,owner_id,name) values('aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa','aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa','reference-test');
do $$ declare payload jsonb; begin
 foreach payload in array array[null::jsonb,'null'::jsonb,'{}'::jsonb,'{"refIds":null}'::jsonb,'{"refIds":[]}'::jsonb,'{"refIds":"wrong"}'::jsonb,'{"refIds":{}}'::jsonb] loop
  begin
   perform public.create_job_with_hold('aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa','reference_qc','aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa',null,payload,'invalid-reference-test',5);
   raise exception 'FLOW_BREACH';
  exception when raise_exception then if sqlerrm<>'REFS_INVALID' then raise; end if; end;
 end loop;
 if exists(select 1 from public.generation_jobs where owner_id='aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa') then raise exception 'Invalid reference created job'; end if;
 if (select balance from public.credit_accounts where user_id='aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa')<>200 then raise exception 'Invalid reference held credits'; end if;
 if exists(select 1 from unnest(array['anon','authenticated','service_role']) as r(name)
   where has_function_privilege(r.name,'public.create_job_with_hold_before_reference_validation(uuid,text,uuid,uuid,jsonb,text,integer)','execute'))
 or exists(select 1 from unnest(array['anon','authenticated']) as r(name)
   where has_function_privilege(r.name,'public.create_job_with_hold(uuid,text,uuid,uuid,jsonb,text,integer)','execute'))
 or not has_function_privilege('service_role','public.create_job_with_hold(uuid,text,uuid,uuid,jsonb,text,integer)','execute') then raise exception 'Validation bypass exposed'; end if;
end $$;

-- The wrapper must retain existing ownership checks and the valid credit path.
do $$
declare
 v_user uuid := 'aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa';
 v_character uuid := 'aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa';
 v_other_character uuid;
 v_asset uuid;
 v_ref uuid;
 v_job uuid;
begin
 insert into public.characters(owner_id,name) values(v_user,'Other reference character') returning id into v_other_character;
 insert into public.assets(owner_id,bucket,object_path,media_type,content_type,bytes,sha256,source)
 values(v_user,'references',v_user||'/reference-validation.jpg','image','image/jpeg',10,'reference-validation','upload') returning id into v_asset;
 insert into public.character_reference_images(character_id,asset_id,kind)
 values(v_other_character,v_asset,'face') returning id into v_ref;
 begin
  perform public.create_job_with_hold(v_user,'reference_qc',v_character,null,jsonb_build_object('refIds',jsonb_build_array(v_ref)), 'wrong-character-reference-test',5);
  raise exception 'FLOW_BREACH';
 exception when raise_exception then if sqlerrm<>'REF_NOT_OWNED' then raise; end if; end;
 if exists(select 1 from public.generation_jobs where owner_id=v_user)
 or exists(select 1 from public.credit_holds where user_id=v_user)
 or (select balance from public.credit_accounts where user_id=v_user)<>200 then raise exception 'Invalid reference reserved credits'; end if;

 update public.character_reference_images set character_id=v_character where id=v_ref;
 v_job:=public.create_job_with_hold(v_user,'reference_qc',v_character,null,jsonb_build_object('refIds',jsonb_build_array(v_ref)), 'valid-reference-test',5);
 if (select status from public.generation_jobs where id=v_job)<>'queued'
 or (select count(*) from public.credit_holds where job_id=v_job)<>1
 or (select balance from public.credit_accounts where user_id=v_user)<>195 then raise exception 'Valid reference reservation failed'; end if;
end $$;
rollback;
