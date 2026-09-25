-- RPC- és függvényjog-tesztek (helyi Supabase-en fut)
\set ON_ERROR_STOP on

-- authenticated SOHA nem hívhatja a SECURITY DEFINER függvényeket (EXECUTE revoke-olva)
set role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","email":"userA@test.hu"}', true);
do $$
begin
  begin
    perform public.credit_hold('11111111-1111-1111-1111-111111111111', gen_random_uuid(), 10, 'test:x');
    raise exception 'PRIV BREACH: authenticated hívhatja a credit_hold-ot';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.claim_job(gen_random_uuid());
    raise exception 'PRIV BREACH: authenticated hívhatja a claim_job-ot';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- service szinten: atomiság, idempotencia, fedezetkezelés
do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_job uuid;
begin
  insert into public.generation_jobs (owner_id, type, status, cost_estimate)
  values (v_user, 'image_generation', 'queued', 10)
  returning id into v_job;

  perform public.credit_hold(v_user, v_job, 10, 'test:hold:1');
  perform public.credit_hold(v_user, v_job, 10, 'test:hold:1'); -- idempotens: nincs dupla levonás
  if (select balance from public.credit_accounts where user_id = v_user) <> 190 then
    raise exception 'CREDIT MISMATCH: balance != 190 (%)',
      (select balance from public.credit_accounts where user_id = v_user);
  end if;

  perform public.credit_charge_hold(v_job, 'test:charge:1');

  -- fedezet nélküli hold visszagörgetve, egyenleg változatlan
  begin
    perform public.credit_hold(v_user, gen_random_uuid(), 100000, 'test:big');
    raise exception 'CREDIT BREACH: fedezet nélküli hold sikerült';
  exception when others then
    if sqlerrm like 'CREDIT BREACH%' then raise; end if;
  end;
  if (select balance from public.credit_accounts where user_id = v_user) <> 190 then
    raise exception 'CREDIT MISMATCH: elégtelen hold nem görgetődött vissza';
  end if;

  -- claim: atomi, dupla claim lehetetlen
  if not public.claim_job(v_job) then
    raise exception 'CLAIM FAILED: első claim nem sikerült';
  end if;
  if public.claim_job(v_job) then
    raise exception 'CLAIM BREACH: ugyanaz a job kétszer claimelve';
  end if;

  -- visszatérítés: pontosan egyszeri
  perform public.credit_refund_job(v_job, 'test:refund:1');
  perform public.credit_refund_job(v_job, 'test:refund:1'); -- idempotens
  if (select balance from public.credit_accounts where user_id = v_user) <> 200 then
    raise exception 'CREDIT MISMATCH: refund nem pontosan egyszeri (%)',
      (select balance from public.credit_accounts where user_id = v_user);
  end if;
end $$;

-- karakter-állapotgép tiltott átmenet
set role postgres;
do $$
declare v_char uuid;
begin
  select id into v_char from public.characters where owner_id = '11111111-1111-1111-1111-111111111111' limit 1;
  update public.characters set status = 'collecting_refs' where id = v_char;
  begin
    update public.characters set status = 'active' where id = v_char; -- tiltott ugrás
    raise exception 'FSM BREACH: collecting_refs → active engedélyezett';
  exception when raise_exception then
    if sqlerrm like 'FSM BREACH%' then raise; end if; -- az elvárt trigger-hiba: illegal transition
  end;
end $$;

-- reference_qc: üres / idegen refIds elutasítva, árva job és hold nélkül
do $$
declare
  v_char uuid;
  v_user uuid := '11111111-1111-1111-1111-111111111111';
begin
  select id into v_char from public.characters where owner_id = v_user limit 1;

  begin
    perform public.create_job_with_hold(v_user, 'reference_qc', v_char, null, '{}', 'test:refs:1', 5);
    raise exception 'FLOW BREACH: üres refIds elfogadva';
  exception when others then
    if sqlerrm like 'FLOW BREACH%' then raise; end if;
  end;

  begin
    perform public.create_job_with_hold(v_user, 'reference_qc', v_char, null,
      '{"refIds":["99999999-9999-9999-9999-999999999999"]}', 'test:refs:2', 5);
    raise exception 'FLOW BREACH: idegen refId elfogadva';
  exception when others then
    if sqlerrm like 'FLOW BREACH%' then raise; end if;
  end;

  if exists (select 1 from public.generation_jobs where idempotency_key like 'test:refs:%') then
    raise exception 'FLOW BREACH: árva job keletkezett';
  end if;
  if exists (select 1 from public.credit_holds where idempotency_key like 'test:refs:%') then
    raise exception 'FLOW BREACH: jogosulatlan hold keletkezett';
  end if;
end $$;

-- finalize_claim: atomi, dupla claim lehetetlen
do $$
declare v_job uuid; v_user uuid := '11111111-1111-1111-1111-111111111111';
begin
  insert into public.generation_jobs (owner_id, type, status, cost_estimate)
  values (v_user, 'image_generation', 'processing', 10)
  returning id into v_job;
  if not public.finalize_claim(v_job) then raise exception 'CLAIM FAILED'; end if;
  if public.finalize_claim(v_job) then
    raise exception 'CLAIM BREACH: dupla finalize_claim'; -- friss lease még nem járt le
  end if;
end $$;

-- ================= reap_stale_jobs =================
-- 20 perce processing job → reaper → queued → újra claimelhető, triggerhiba nélkül
do $$
declare
  v_job uuid;
  v_user uuid := '11111111-1111-1111-1111-111111111111';
begin
  insert into public.generation_jobs (owner_id, type, status, cost_estimate, started_at)
  values (v_user, 'image_generation', 'processing', 10, now() - interval '20 minutes')
  returning id into v_job;

  if public.reap_stale_jobs() < 1 then
    raise exception 'REAP FAILED: a reaper nem találta a beragadt jobot';
  end if;
  if (select status from public.generation_jobs where id = v_job) <> 'queued' then
    raise exception 'REAP BREACH: a job nem queued állapotú';
  end if;
  -- a reaper nullázza a started_at-ot: az újraindítás friss időpontot kap
  if (select started_at from public.generation_jobs where id = v_job) is not null then
    raise exception 'REAP BREACH: a started_at nem nullázódott';
  end if;
  if not public.claim_job(v_job) then
    raise exception 'REAP BREACH: a job nem újrafeldolgozható';
  end if;
  if (select started_at from public.generation_jobs where id = v_job) < now() - interval '1 minute' then
    raise exception 'REAP BREACH: a claim nem friss started_at-et adott';
  end if;
  -- azonnali újabb reaper nem veheti fel újra a frissen indított jobot
  perform public.reap_stale_jobs();
  if (select status from public.generation_jobs where id = v_job) <> 'submitted' then
    raise exception 'REAP BREACH: friss jobot újra reapeltek';
  end if;
end $$;

-- ================= complete_job_transactional atomiság =================
do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_char uuid;
  v_asset uuid;
  v_ref uuid;
  v_job uuid;
  v_setup_job uuid;
begin
  -- karakter előkészítése ready_to_train-ig SZABÁLYOS jobrekorddal
  -- (a flow tulajdon-ellenőrzése miatt valódi generation_jobs sor kell)
  insert into public.characters (owner_id, name, status)
  values (v_user, 'Tx-teszt', 'collecting_refs') returning id into v_char;
  insert into public.assets (owner_id, bucket, object_path, media_type, content_type, bytes, sha256, source)
  values (v_user, 'references', v_user || '/tx.jpg', 'image', 'image/jpeg', 10, 'tx-sha', 'upload')
  returning id into v_asset;
  insert into public.character_reference_images (character_id, asset_id, kind)
  values (v_char, v_asset, 'face') returning id into v_ref;

  insert into public.generation_jobs (owner_id, type, character_id, payload, status, cost_estimate, started_at)
  values (v_user, 'reference_qc', v_char,
          jsonb_build_object('refIds', jsonb_build_array(v_ref::text)),
          'processing', 5, now())
  returning id into v_setup_job;
  perform public.apply_mock_flow_step(v_setup_job, 'reference_qc', v_char, null, array[v_ref]::uuid[], 'mock', null);
  delete from public.generation_jobs where id = v_setup_job;
  if (select status from public.characters where id = v_char) <> 'ready_to_train' then
    raise exception 'SETUP HIBA: karakter nem ready_to_train';
  end if;

  -- 1) FLOW utáni CHARGE-hiba: hold nélküli, finalizing job
  insert into public.generation_jobs (owner_id, type, character_id, status, cost_estimate, started_at)
  values (v_user, 'character_training', v_char, 'finalizing', 300, now())
  returning id into v_job;
  begin
    perform public.complete_job_transactional(v_job, null, '{}'::uuid[], 'mock', null);
    raise exception 'TX BREACH: hold nélkül a charge nem bukott';
  exception when others then
    if sqlerrm like 'TX BREACH%' then raise; end if;
  end;
  -- a karakter NEM lépett elő, verzió nincs, charge nincs, a job finalizing maradt
  if (select status from public.characters where id = v_char) <> 'ready_to_train' then
    raise exception 'TX BREACH: charge-hiba után a karakter mégis előrelépett';
  end if;
  if exists (select 1 from public.character_versions where character_id = v_char) then
    raise exception 'TX BREACH: verzió keletkezett sikertelen tranzakcióban';
  end if;
  if exists (select 1 from public.credit_transactions where type = 'charge' and hold_id in
             (select id from public.credit_holds where job_id = v_job)) then
    raise exception 'TX BREACH: charge történt sikertelen tranzakcióban';
  end if;
  if (select status from public.generation_jobs where id = v_job) <> 'finalizing' then
    raise exception 'TX BREACH: a job állapota mégis megváltozott';
  end if;

  -- 2) érvénytelen flow esetén sincs charge (identity_check tiltott karakterállapotból)
  update public.generation_jobs set type = 'identity_check' where id = v_job;
  begin
    perform public.complete_job_transactional(v_job, null, '{}'::uuid[], 'mock', null);
    raise exception 'TX BREACH: érvénytelen flow nem bukott';
  exception when others then
    if sqlerrm like 'TX BREACH%' then raise; end if;
  end;
  if exists (select 1 from public.credit_transactions where type = 'charge' and hold_id in
             (select id from public.credit_holds where job_id = v_job)) then
    raise exception 'TX BREACH: sikertelen flow után charge történt';
  end if;

  -- 3) sikeres út: hold + érvényes training flow → egyszeri charge, completed, karakter test_pending
  -- (a tréning ára 300 – a teszthez elegendő egyenleg kell, NEM szabad az árat csökkenteni)
  update public.credit_accounts set balance = 700 where user_id = v_user;
  delete from public.generation_jobs where id = v_job;
  insert into public.generation_jobs (owner_id, type, character_id, status, cost_estimate, started_at)
  values (v_user, 'character_training', v_char, 'finalizing', 300, now())
  returning id into v_job;
  perform public.credit_hold(v_user, v_job, 300, 'tx:hold:' || v_job);
  -- hold utáni elérhető egyenleg: 700 - 300 = 400
  if (select balance from public.credit_accounts where user_id = v_user) <> 400 then
    raise exception 'TX BREACH: hold utáni egyenleg != 400 (%)',
      (select balance from public.credit_accounts where user_id = v_user);
  end if;
  perform public.complete_job_transactional(v_job, null, '{}'::uuid[], 'mock', null);
  -- charge a foglalást minősíti: az egyenleg továbbra is 400
  if (select balance from public.credit_accounts where user_id = v_user) <> 400 then
    raise exception 'TX BREACH: charge utáni elszámolás hibás (%)',
      (select balance from public.credit_accounts where user_id = v_user);
  end if;
  if (select status from public.generation_jobs where id = v_job) <> 'completed' then
    raise exception 'TX BREACH: a job nem completed';
  end if;
  if (select status from public.characters where id = v_char) <> 'test_pending' then
    raise exception 'TX BREACH: karakter nem test_pending';
  end if;
  -- pontosan egy verzió
  if (select count(*) from public.character_versions where character_id = v_char) <> 1 then
    raise exception 'TX BREACH: a karakter nem pontosan egy verziót kapott';
  end if;
  if (select count(*) from public.credit_transactions where type = 'charge' and hold_id in
      (select id from public.credit_holds where job_id = v_job)) <> 1 then
    raise exception 'TX BREACH: a charge nem pontosan egyszeri';
  end if;

  -- 4) újrahívás: nincs dupla charge (JOB_NOT_FINALIZING védelem)
  begin
    perform public.complete_job_transactional(v_job, null, '{}'::uuid[], 'mock', null);
    raise exception 'TX BREACH: dupla véglegesítés engedélyezett';
  exception when others then
    if sqlerrm like 'TX BREACH%' then raise; end if;
  end;
  if (select count(*) from public.credit_transactions where type = 'charge' and hold_id in
      (select id from public.credit_holds where job_id = v_job)) <> 1 then
    raise exception 'TX BREACH: dupla charge történt';
  end if;
end $$;

-- ================= provider submission ledger =================
do $$
declare
  v_job uuid;
  v_user uuid := '11111111-1111-1111-1111-111111111111';
begin
  insert into public.generation_jobs (owner_id, type, status, cost_estimate, started_at)
  values (v_user, 'image_generation', 'processing', 10, now())
  returning id into v_job;

  if not public.begin_provider_submission(v_job) then
    raise exception 'LEDGER FAILED: első submit-jog nem kapható';
  end if;
  if public.begin_provider_submission(v_job) then
    raise exception 'LEDGER BREACH: dupla submit-jog';
  end if;
  if not public.record_provider_submission(v_job, 'replicate', 'req_1', '{}'::jsonb) then
    raise exception 'LEDGER FAILED: első record nem sikerült';
  end if;
  if public.record_provider_submission(v_job, 'replicate', 'req_2', '{}'::jsonb) then
    raise exception 'LEDGER BREACH: dupla record';
  end if;
  if (select provider_job_id from public.generation_jobs where id = v_job) <> 'req_1' then
    raise exception 'LEDGER BREACH: a provider_job_id felülíródott';
  end if;
  if (select provider from public.generation_jobs where id = v_job) <> 'replicate' then
    raise exception 'LEDGER BREACH: a tényleges provider nem került az adatbázisba';
  end if;
end $$;

-- ================= submission_uncertain: submitted ÉS processing alól; hold megmarad =================
do $$
declare
  v_job uuid; v_user uuid := '11111111-1111-1111-1111-111111111111';
begin
  -- submitted → submission_uncertain
  insert into public.generation_jobs (owner_id, type, status, cost_estimate, started_at)
  values (v_user, 'image_generation', 'submitted', 10, now()) returning id into v_job;
  update public.generation_jobs set status = 'submission_uncertain' where id = v_job;
  if (select status from public.generation_jobs where id = v_job) <> 'submission_uncertain' then
    raise exception 'UNCERTAIN FAILED: submitted → submission_uncertain nem működik';
  end if;
  -- processing → submission_uncertain
  update public.generation_jobs set status = 'processing' where id = v_job;  -- uncertain → processing szabályos
  update public.generation_jobs set status = 'submission_uncertain' where id = v_job;
  -- hold megmarad, NINCS refund (nincs credit_holds sor ehhez a jobhoz → refund nem történhet)
  if exists (select 1 from public.credit_transactions where job_id is null and type = 'refund' and note like '%' || v_job::text || '%') then
    raise exception 'UNCERTAIN BREACH: auto-refund történt';
  end if;
end $$;

-- ================= reaper: submission_started + nincs provider_job_id → NEM újraindítjuk =================
do $$
declare
  v_job uuid; v_user uuid := '11111111-1111-1111-1111-111111111111';
begin
  insert into public.generation_jobs (owner_id, type, status, cost_estimate, started_at, provider_meta)
  values (v_user, 'image_generation', 'processing', 10, now() - interval '20 minutes',
          '{"submission_started": true}'::jsonb)
  returning id into v_job;
  perform public.reap_stale_jobs();
  if (select status from public.generation_jobs where id = v_job) = 'queued' then
    raise exception 'REAPER BREACH: bizonytalan submitot újraindított a reaper';
  end if;
  if (select status from public.generation_jobs where id = v_job) <> 'submission_uncertain' then
    raise exception 'REAPER BREACH: a reaper nem uncertain-be tette';
  end if;
end $$;

-- ================= reconcile RPC-k: konkurencia + idempotencia =================
do $$
declare
  v_job uuid; v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_admin uuid; v_ok boolean;
begin
  select id into v_admin from public.profiles where role = 'admin' limit 1;
  if v_admin is null then
    update public.profiles set role = 'admin' where id = v_user returning id into v_admin;
  end if;
  insert into public.generation_jobs (owner_id, type, status, cost_estimate, started_at, provider_meta)
  values (v_user, 'image_generation', 'submission_uncertain', 10, now(), '{"submission_started": true}'::jsonb)
  returning id into v_job;

  -- két párhuzamos mark_submitted: pontosan egy érvényesül
  v_ok := public.admin_mark_submitted(v_job, 'fal', 'req_admin_1', v_admin, 'dashboard-ellenőrzés');
  if public.admin_mark_submitted(v_job, 'fal', 'req_admin_2', v_admin, 'második kísérlet') then
    raise exception 'RECONCILE BREACH: dupla mark_submitted';
  end if;
  if not v_ok then raise exception 'RECONCILE FAILED: első mark_submitted nem érvényesült'; end if;
  if (select provider_job_id from public.generation_jobs where id = v_job) <> 'req_admin_1' then
    raise exception 'RECONCILE BREACH: rossz request ID mentődött';
  end if;
end $$;

do $$
declare
  v_job uuid; v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_admin uuid; v_bal_before integer;
begin
  select id into v_admin from public.profiles where role = 'admin' limit 1;
  insert into public.generation_jobs (owner_id, type, status, cost_estimate, started_at, provider_meta)
  values (v_user, 'image_generation', 'submission_uncertain', 10, now(), '{"submission_started": true}'::jsonb)
  returning id into v_job;
  perform public.credit_hold(v_user, v_job, 10, 'recon:hold:' || v_job);
  select balance into v_bal_before from public.credit_accounts where user_id = v_user;

  -- két párhuzamos mark_failed: pontosan egy refund
  if not public.admin_mark_failed(v_job, v_admin, 'bizonyítottan nem futott') then
    raise exception 'RECONCILE FAILED: első mark_failed nem érvényesült';
  end if;
  if public.admin_mark_failed(v_job, v_admin, 'második kísérlet') then
    raise exception 'RECONCILE BREACH: dupla mark_failed';
  end if;
  if (select balance from public.credit_accounts where user_id = v_user) <> v_bal_before + 10 then
    raise exception 'RECONCILE BREACH: a refund nem pontosan egyszeri';
  end if;

  -- restart: csak uncertain-ből, egyszer
  insert into public.generation_jobs (owner_id, type, status, cost_estimate, started_at, provider_meta)
  values (v_user, 'image_generation', 'submission_uncertain', 10, now(), '{"submission_started": true}'::jsonb)
  returning id into v_job;
  if not public.admin_restart(v_job, v_admin, 'dashboard: nincs futó munka') then
    raise exception 'RECONCILE FAILED: restart nem érvényesült';
  end if;
  if public.admin_restart(v_job, v_admin, 'újra') then
    raise exception 'RECONCILE BREACH: dupla restart';
  end if;
  if (select status from public.generation_jobs where id = v_job) <> 'queued' then
    raise exception 'RECONCILE BREACH: a restart nem queued-ba tette';
  end if;
  if coalesce((select provider_meta ->> 'submission_started' from public.generation_jobs where id = v_job), 'false') = 'true' then
    raise exception 'RECONCILE BREACH: a submission claim nem törlődött';
  end if;
end $$;

-- ================= valós-provider fixture: VALÓDI folyamat, nem közvetlen insert =================
do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_char uuid; v_asset uuid; v_ref uuid; v_job uuid; v_ver uuid; v_claim jsonb;
begin
  insert into public.characters (owner_id, name, status)
  values (v_user, 'RealProvider-fixture', 'ready_to_train') returning id into v_char;
  insert into public.assets (owner_id, bucket, object_path, media_type, content_type, bytes, sha256, source)
  values (v_user, 'references', v_user || '/rp.jpg', 'image', 'image/jpeg', 10, 'rp-sha', 'upload')
  returning id into v_asset;
  insert into public.character_reference_images (character_id, asset_id, kind)
  values (v_char, v_asset, 'face') returning id into v_ref;
  insert into public.generation_jobs (owner_id, type, character_id, payload, status, cost_estimate, started_at)
  values (v_user, 'reference_qc', v_char, jsonb_build_object('refIds', jsonb_build_array(v_ref::text)),
          'processing', 5, now()) returning id into v_job;
  perform public.apply_mock_flow_step(v_job, 'reference_qc', v_char, null, array[v_ref]::uuid[], 'mock', null);

  -- 1) VALÓDI folyamat: claim → create_job_with_hold (versionId) → finalizing → complete
  update public.credit_accounts set balance = 700 where user_id = v_user;
  v_claim := public.claim_character_version(v_char, 'fal', null, null, null, 'prep-rp-' || v_char::text);
  v_ver := (v_claim ->> 'version_id')::uuid;
  v_job := public.create_job_with_hold(
    v_user, 'character_training', v_char, null,
    jsonb_build_object('destination', 'me/real-lora',
                       'imagesDataUrl', 'data:application/zip;base64,AAAA',
                       'versionId', v_ver::text),
    'test:realprov:' || v_char::text, 300);
  -- szabályos finalizing-állapot: queued → submitted → processing → finalizing
  update public.generation_jobs set status = 'submitted' where id = v_job;
  update public.generation_jobs set status = 'processing' where id = v_job;
  update public.generation_jobs set status = 'finalizing' where id = v_job;
  update public.generation_jobs set provider_job_id = 'fal_real_1' where id = v_job;
  perform public.complete_job_transactional(v_job, null, '{}'::uuid[], 'fal', 'https://weights.example/lora.bin');

  -- 2) pontosan a KÖTÖTT verzió fejlődött; tényleges provider + job ID + weights; NINCS legacy második verzió
  if (select count(*) from public.character_versions where character_id = v_char) <> 1 then
    raise exception 'REALPROV BREACH: legacy/dupla verzió keletkezett';
  end if;
  if (select generation_job_id from public.character_versions where id = v_ver) <> v_job then
    raise exception 'REALPROV BREACH: a verzió nem a jobhoz kötött';
  end if;
  if (select status from public.character_versions where id = v_ver) <> 'test_pending' then
    raise exception 'REALPROV BREACH: a kötött verzió nem test_pending';
  end if;
  if (select provider from public.character_versions where id = v_ver) <> 'fal' then
    raise exception 'REALPROV BREACH: tényleges provider nem mentődött';
  end if;
  if (select provider_job_id from public.character_versions where id = v_ver) <> 'fal_real_1' then
    raise exception 'REALPROV BREACH: a provider job ID nem mentődött';
  end if;
  if (select provider_model_ref from public.character_versions where id = v_ver) <> 'https://weights.example/lora.bin' then
    raise exception 'REALPROV BREACH: weights URL nem mentődött';
  end if;

  -- 3) kötésvédelem: két LÉTEZŐ job; a kötés az engedélyezett RPC-folyamaton keresztül nem írható felül
  declare v_job2 uuid;
  begin
    v_job2 := public.create_job_with_hold(
      v_user, 'image_generation', null, null, '{}', 'test:bind2:' || v_char::text, 10);
    -- a verzió már 'test_pending' → a tréning-prekondíció amúgy is elutasítaná; a konkrét üzenet:
    begin
      perform public.create_job_with_hold(
        v_user, 'character_training', v_char, null,
        jsonb_build_object('destination', 'me/x', 'imagesDataUrl', 'data:x', 'versionId', v_ver::text),
        'test:bind3:' || v_char::text, 300);
      raise exception 'BIND BREACH: a kötött verzióhoz második tréningjob köthető';
    exception when raise_exception then
      if sqlerrm like 'BIND BREACH%' then raise; end if;
      -- VERSION_NOT_CLAIMED / CHARACTER_NOT_READY – várt elutasítás
    end;
    if (select generation_job_id from public.character_versions where id = v_ver) <> v_job then
      raise exception 'BIND BREACH: a kötés felülíródott';
    end if;
  end;
end $$;

-- ================= image_generation: DB-szintű karakterkötelezettség (0018) =================
do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_char uuid; v_ver uuid; v_ok uuid; v_asset uuid; v_ref uuid;
begin
  insert into public.characters (owner_id, name, status)
  values (v_user, 'ImgGen-gate', 'active') returning id into v_char;
  insert into public.character_versions (character_id, version_no, status, provider, provider_model_ref)
  values (v_char, 1, 'approved', 'fal', 'https://v3.fal.media/w/x.bin')
  returning id into v_ver;
  update public.characters set active_version_id = v_ver where id = v_char;

  -- karakter NÉLKÜL: sikertelen
  begin
    perform public.create_job_with_hold(v_user, 'image_generation', null, null, '{}', 'test:ig:1', 10);
    raise exception 'IG BREACH: karakter nélküli image_generation elfogadva';
  exception when raise_exception then
    if sqlerrm like 'IG BREACH%' then raise; end if;
  end;
  -- idegen karakter: sikertelen
  begin
    perform public.create_job_with_hold(v_user, 'image_generation', '99999999-9999-9999-9999-999999999999', null, '{}', 'test:ig:2', 10);
    raise exception 'IG BREACH: idegen karakterrel elfogadva';
  exception when raise_exception then
    if sqlerrm like 'IG BREACH%' then raise; end if;
  end;
  -- active_version_id NÉLKÜL: sikertelen
  update public.characters set active_version_id = null where id = v_char;
  begin
    perform public.create_job_with_hold(v_user, 'image_generation', v_char, null, '{}', 'test:ig:3', 10);
    raise exception 'IG BREACH: aktív verzió nélkül elfogadva';
  exception when raise_exception then
    if sqlerrm like 'IG BREACH%' then raise; end if;
  end;
  update public.characters set active_version_id = v_ver where id = v_char;
  -- nem approved verzió: sikertelen
  update public.character_versions set status = 'training' where id = v_ver;
  begin
    perform public.create_job_with_hold(v_user, 'image_generation', v_char, null, '{}', 'test:ig:4', 10);
    raise exception 'IG BREACH: nem approved verzióval elfogadva';
  exception when raise_exception then
    if sqlerrm like 'IG BREACH%' then raise; end if;
  end;
  update public.character_versions set status = 'approved' where id = v_ver;
  -- provider_model_ref NÉLKÜL: sikertelen
  update public.character_versions set provider_model_ref = null where id = v_ver;
  begin
    perform public.create_job_with_hold(v_user, 'image_generation', v_char, null, '{}', 'test:ig:5', 10);
    raise exception 'IG BREACH: LoRA-ref nélkül elfogadva';
  exception when raise_exception then
    if sqlerrm like 'IG BREACH%' then raise; end if;
  end;
  update public.character_versions set provider_model_ref = 'https://v3.fal.media/w/x.bin' where id = v_ver;
  -- JÓ aktív karakterrel: sikeres (hold+queue)
  v_ok := public.create_job_with_hold(v_user, 'image_generation', v_char, null,
    jsonb_build_object('prompt', 'portré', 'loraPath', 'https://v3.fal.media/w/x.bin'),
    'test:ig:6', 10);
  if (select status from public.generation_jobs where id = v_ok) <> 'queued' then
    raise exception 'IG BREACH: a sikeres job nem queued';
  end if;
end $$;

select 'RPC_TEST_PASSED' as result;
