# CHANGELOG – v0.7.1 (2026-09-25) – biztonsági és kiadási javítások

1. Stripe Checkout metadata javítva; aláírás-ellenőrzés minden írás előtt; replay-védelem,
   purchase/plan/user ellenőrzés és kreditjóváírás egyetlen `process_stripe_event` DB-tranzakcióban.
2. A számlázott tartalomfeladatok hibás hold/charge/refund RPC után nem folytatódnak csendben.
3. Albumos galériaszűrés csak a hitelesített tulajdonos albumán és elemein belül működik;
   `all`, album nélküli, idegen és hibás albumazonosító válaszszintű tesztekkel fedve.
4. Carousel valódi SHA-256-ot és gallery rekordot készít, a projekt tulajdonát ellenőrzi.
5. Admin ban middleware- és API-auth szinten érvényesül; plans RLS és explicit grants bekerült.
6. Pinterest Composition, Motion Control és karakterválasztó UI; projektek átnevezése.
7. Reels/Trends/Niche valódi, konfigurálható OpenAI-kompatibilis providert használ; kulcs nélkül
   `CONTENT_AI_NOT_CONFIGURED`, kreditfoglalás és hamis fallback nélkül.
8. Node 22.22.0 / npm 11.9.0 CI-rögzítés, v0.7.1 verziószinkron és 0022–0023 migráció.
9. Friss Supabase telepítésen javított migrációs sorrend; a két szabálytábla RLS-sel és
   read-only authenticated policyval védett, a triggerfüggvények search path-ja rögzített.
10. Gyökérút a hitelesített dashboard-folyamatra irányít; a 0024–0025 migrációk megtiltják
    az `is_admin()` jogosultságsegéd anonim Data API-hívását, miközben az authenticated RLS működik.

# CHANGELOG – v0.6.0 (2026-09-23) – M6 funkciócsomag

## Korábban BLOCKED eszközök – VALÓDI implementációk
1. **fal.ai adapter bővítés – dokumentált végpontok**: Image-to-Prompt (`fal-ai/imageutils/caption`,
   BLIP-felirat), Upscale (`fal-ai/esrgan`, Real-ESRGAN), Background Removal (`fal-ai/birefnet`),
   Character Swap (`fal-ai/face-swap`), Talking Video/Lip Sync (`fal-ai/sync-lips`, videó+hang),
   Video-to-Video (`fal-ai/kling-video/v2.1/master/video-to-video`). Skin Enhancer és Fix Face:
   SZERVEROLDALI preset-promptok nano-banana editen keresztül.
2. **Séma + prepareJob**: új típusok bemenet-validációja (asset→signed URL, audio, swap-fotó,
   SSRF); `sniffMedia` audio-támogatással (MP3 ID3/frame, WAV RIFF) az assets/import-ban.
3. **Eszköz-UI teljes újraírás**: minden eszköz valódi folyamattal (picker/feltöltés, ár, indítás,
   progress, eredmény player/letöltés/galéria, retry) – a „Hamarosan" kártyák eltűntek az
   eszközökről; kulcs nélkül őszinte NO_PROVIDER_CONFIGURED.
4. **Galéria teljes**: keresés, médiatípus-szűrés, albumok (`/api/albums`), tömeges kiválasztás,
   albumba helyezés, tömeges törlés.
5. **Content Calendar teljes**: `/api/calendar` CRUD + oldal (ütemezés, státusz, törlés).
6. **Admin bővítés**: `/api/admin/summary` (felhasználók, job-státuszok aggregálva, nyitott
   moderációs jelzők, 30 napos kreditégetés) + `0019_admin_stats.sql`; az admin oldalon
   összesítő szekció.
7. **Reszponzív**: mobil töréspontok a gridhez.

## Még hiányzik (M7, a mátrix szerint)
Viral Reels Copy, Viral Trends, Niche, Carousel, TikTok-import, Pinterest-kompozíció,
Motion Control (igazolt modell kell), Stripe fizetés, élő Resend.

# CHANGELOG – v0.5.6 (2026-09-23)

## Javítások
1. **v0.5.5-ös teszt-timeout javítva** – a „Generator: váratlan fetchhiba" guardedRun-teszt TELJESEN hálózatmentes: minden fetch mockolt.
2. **Verziómezők szinkronizálva** – package.json, package-lock top-level és packages[""] mind 0.5.6.

# CHANGELOG – v0.5.5 (2026-09-23)

## Audit-javítások (v0.5.4 független ellenőrzése alapján)
1. **Generator busy helyreállítása** – a teljes token + `startJobWithTracker` hívás a közös
   `guardedRun` try/catch/finally-ében: induláskor `setBusy(true)`, BÁRMELY hiba szabályozott
   üzenettel, finally-ben MINDEN esetben `setBusy(false)` + guard feloldás – nincs unhandled rejection.
2. **Tools busyKey helyreállítása** – ugyanígy: tokenlekérés, estimate fetch, estimate JSON
   feldolgozás, `startJobWithTracker`, eredményfeldolgozás egy védett folyamatban; finally-ben
   `setBusyKey(null)`; estimate hálózati/JSON hiba → a job NEM indul; a következő attempt működik.
3. **Célzott tesztek** – `tests/guardedRun.test.ts` (6): tokenhiba → busy false; fetchhiba → busy
   false + következő attempt sikeres; estimate fetch dob → busyKey null, 0 job POST; hibás estimate
   JSON → busyKey null, 0 job; job dupla hiba → busyKey null + retry; sikeres futás busy sorrenddel.
   Minden eset awaitelve – unhandled rejection nincs.

# CHANGELOG – v0.5.4 (2026-09-23)

## Audit-javítások (v0.5.3 független ellenőrzése alapján)
1. **Valódi szinkron duplaindítás-védelem** – `src/lib/jobs/submitGuard.ts` (`createSubmitGuard` +
   `withSubmitGuard`): a Generator és a Tools run() ELŐSZÖR szinkron zárat állít (minden await
   előtt), finally-ben oldja; az estimate + token + teljes job-ideje alatt aktív; új tracker csak
   szabad guardnál jön létre. (A React `busy` state önmagában nem szinkron zár – ez volt a rés.)
2. **Valódi UI-folyamat tesztek** – `tests/submitGuard.test.ts`: két SZINKRON Generator start →
   pontosan 1 estimate + 1 `/api/jobs` POST; ugyanígy Tools/I2V; biztos HTTP-válasz után retry ÚJ
   kulcs; hálózati újraküldés AZONOS kulcs; hiba esetén is felold a guard.
3. **Félrevezető retry-teszt javítva** – számlálós generátor: `uuid-1`, finish után `uuid-2`.
4. **TEST_REPORT pontosság** – tesztfájl-összegzés: 25 passed + 4 skipped = 29 (nem 26).

# CHANGELOG – v0.5.3 (2026-09-23)

## Audit-javítások (v0.5.2 független ellenőrzése alapján)
1. **Lint 0 warning** – tools inicializáló effect: stabil `init` useCallback + helyes dependency
   lista (nincs eslint-disable, nincs elrejtés).
2. **createAttemptTracker bekötve a valódi UI-ba** – új `src/lib/jobs/startJob.ts`
   (`startJobWithTracker`): a /api/jobs body MINDIG tartalmazza az idempotencyKey-t; első indítás
   új explicit UUID, hálózati hiba azonos kulccsal újraküld (max 1), biztos HTTP-válasz után finish,
   felhasználói retry új tracker = új kulcs, dupla kattintásnál begin null = nincs második POST,
   gomb disabled kérés alatt. **5 teszt assertálja a tényleges fetch body-t** (első indítás, I2V/TTS,
   dupla kattintás 1 POST, hálózati újraküldés azonos kulcs, retry új kulcs külön trackerrel).
3. **TEST_REPORT.md a ZIP gyökerében** – a v0.5.2-ből hiányzott; kizárólag a végső tiszta futás
   tényleges eredményeivel (hat parancs exit code, lint 0/0, tesztszámok, skipped nevekkel,
   route manifest, build warningok őszintén, NOT RUN szekció).
4. **CHANGELOG pontosítás** – a v0.5.2 bejegyzésében a „lint 0 warning” és a „TEST_REPORT” hamis
   állításai javítva/jelölve; ebben a verzióban mindkettő ténylegesen teljesül.

# CHANGELOG – v0.5.2 (2026-09-23)

## Audit-javítások (v0.5.1 független ellenőrzése alapján)
1. **Lint warning** – az inicializáló effect dependency-listája javítva (stabil `init` useCallback); a v0.5.2 állapotában 1 warning volt, itt javítva.
2. **projectId regresszió javítva** – a közös `prepareValidatedJobInput` kezeli: UUID-validáció
   (séma), ownership (403 PROJECT_NOT_OWNED), megőrzés a PreparedJob-ban, továbbadás a
   `create_jobWithHold`-nak; estimate-ben is módosítás nélkül. Tesztek: saját továbbmegy / idegen 403
   hold nélkül / hibás 400 / nélküle megy.
3. **Kliens loraPath teljes kizárása** – a prep ELEJÉN `delete payload.loraPath; delete
   payload.activeVersionId;` – csak sikeres szerveroldali feloldás után kerül vissza. Tesztelve
   image_generation/I2V/image_edit útvonalakon.
4. **I2V valódi ár-megjelenítés** – „Várható ár: X kredit" state-ben; frissül modell/időtartam/
   karakter/motion/ratio/bemenet változására; estimate-hiba esetén a job NEM indul.
5. **Idempotens retry** – `createAttemptTracker`: begin új kulcs, resend ugyanaz, finish után új,
   dupla begin null (egyszerre egy kérés); a gomb busy alatt disabled. Tesztelve.
6. **Poller versenyhelyzet** – inFlight jelző (egy jobhoz egyszerre egy fetch), generation/
   cancellation token: stop/stopAll után a folyamatban lévő fetch eredménye NEM hív onUpdate-et.
   3 új célzott teszt (stop terminal előtt, lassú fetch vs interval, stopAll utáni Promise).
7. **Job result bucket** – a gallery embed kéri a `bucket`-et; signed URL `svc.storage.from(asset.bucket)`
   – nincs hardcode; teszt eltérő bucketnévvel (`custom-results`).
8. **TEST_REPORT** – a gyökérkönyvtárban, kizárólag a tényleges utolsó futás számaival (a v0.5.2-ben hiányzott a gyökérből – javítva).

# CHANGELOG – v0.5.1 (2026-09-23)

## Ellenőrzési javítások (v0.5.0 audit alapján)
1. **Hook warningok**: stabil `useCallback` (`loadResults(jobId)` a generate-ben), `token` a getSb-n
   keresztül – 0 lint warning (nincs eslint-disable).
2. **Polling életciklus** (`src/lib/jobs/poller.ts` + 6 unit-teszt): per-job `JobPoller` – unmount
   `stopAll`, terminal státusz auto-stop, max attempts (timeout), max consecutive errors (hálózati
   hiba), dupla-start ellen, több job párhuzamosan. Unmount utáni state update nincs.
3. **Több Tools-job**: jobonkénti polling – Editor/I2V/TTS nem állítja le egymást.
4. **I2V eredményfelület**: kreditár (estimate), progress badge, terminal error, **konkrét jobhoz
   tartozó videó** (`/api/jobs/[id]` → assetId/galleryItemId/mediaType/signed URL), beépített
   `<video>` player, letöltés, „Megnyitás a galériában" link, retry.
5. **Generator eredménykapcsolat**: a „eredmény" CSAK az aktuális job képeit mutatja
   (`/api/jobs/[id]` results); a korábbi galéria külön szekció marad.
6. **Közös input-előkészítés** (`src/server/jobs/prepareJob.ts`): estimate ÉS job route UGYANAZT a
   `prepareValidatedJobInput`-ot használja (séma, age, karakter/LoRA, Easy prompt, TTS, I2V allowlist,
   asset-ownership, signed URL, SSRF, normalizált payload) → árparitás garantált.
7. **Estimate típusbiztonság**: `JobTypeSchema` enum (nincs z.string()); szabályozott hibák
   (400/401/403/409/503/502 PROVIDER_ESTIMATE_FAILED); ismeretlen típus → 400, nem 500.
8. **I2V validáció**: duration ∈ {5,10}, aspectRatio enum, motionStrength 1–255, cfg 0–1, model
   allowlist, sourceAssetId UUID – szerver normalizál számmá.
9. **Idempotencia/retry**: minden start új explicit UUID; dupla kattintás busy-flag; a kulcs újraküldhető.
10. **Új route**: `GET /api/jobs/[id]` – job + pontos eredmény-assetek signed URL-lel.

# CHANGELOG – v0.5.0 (2026-09-23) – M3 funkciófejlesztés

1. **Teljes AI Image Generator** (`generate/page.tsx` újraírva): Easy/Expert, karakterválasztó +
   aktív verzió-kijelzés, méret/képszám/prompt/negative/seed/steps/guidance, **kreditár-becslés
   generálás előtt** (`/api/jobs/estimate` – LoRA-feloldással, foglalás nélkül), állapot-poll,
   hibaüzenet, retry, eredmény-thumbnails + letöltés (galériába mentve). A loraPath továbbra is
   KIZÁRÓLAG szerveroldali.
2. **Image-to-Video TELJES felület** (`tools/page.tsx`): bemeneti kép (feltöltés/galéria), opcionális
   karakter (lora-injektálás), prompt, időtartam, képarány, motion strength, **modellválasztás a
   szerver engedélyezett listájából** (`/api/config/provider` i2vModels), becslés, job-progress,
   galériamentés. fal adapter: motion/cfg mapping.
3. **Eszközoldal rendezve**: Image Editor / I2V / TTS teljes folyamattal; a nem kész eszközök
   (Image-to-Prompt, Character Swap, Upscale, Background Removal, Skin Enhancer, Fix Face, Talking
   Video, Lip Sync) „Hamarosan" kártyák – NINCS olyan gomb, amely nem megvalósított jobot indítana.
4. **fal adapter**: `negative_prompt`, `guidance_scale` (flux-lora), `motion_bucket_id`/`cfg_scale` (kling).
5. **E2E scaffold**: `playwright.config.ts` + `tests/e2e/smoke.spec.ts` (auth-mentes füsttesztek:
   login/register/terms/privacy + védett route redirect). A teljes auth-/generálós E2E futtatásához
   futó alkalmazás + Supabase kell – NOT RUN helyben (lásd TEST_REPORT).

# CHANGELOG – v0.4.4 (2026-09-23)

## Ellenőrzési és deployment-lezárási javítások
1. **`tests/galleryApi.test.ts` tulajdon-szigetelés VALÓDI bizonyítékokkal**: a PostgREST-kérésben
   `owner_id=eq.<uid>` assertálva; idegen `owner_id` soha nem szerepel; pontosan annyi Storage-sign
   hívás, ahány elem; az idegen objektumútvonal SOHA nem kerül aláírási kérésbe.
2. **`tests/jobsRoute.test.ts`**: elavult komment törölve (a `lastJobPayload`/`lastCharacter`/`lastKey`
   assertok már a teljes payload-ot fedik).
3. **TEST_REPORT build-sor**: ellenőrizetlen route-szám helyett a buildlogból vett tényleges adat.
4. **Edge Runtime warning**: audit – a middleware KIZÁRÓLAG `@supabase/ssr` createServerClient-et és
   `next/server`-t importál (grep-bizonyíték a csomagban); `process.version` figyelmeztetés a
   `@supabase/supabase-js` dependencyből jön (upstream, ismert, nem blokkoló). Login/redirect/session
   Edge-beli működéséhez Vercel-deploy kell – NOT RUN (lásd TEST_REPORT).

# CHANGELOG – v0.4.3 (2026-09-23)

## Funkcionális javítások (v0.4.2 audit alapján)
1. **`/api/gallery`**: minden elem `id` (visszafelé kompatibilis) + `galleryItemId` + `assetId` +
   mediaType/contentType/bytes/qcStatus/characterId + signed URL; új `tests/galleryApi.test.ts`
   (két ID eltérhet, idegen elem nincs, signed URL az object_path alapján).
2. **Easy Mode payload** (`generate/page.tsx`): az easy ág most már `imageSize`-t és `numImages`-t is
   küld; `tests/jobsRoute.test.ts` harness tárolja a `create_job_with_hold` `p_payload`/`p_character`/
   `p_key`-t; VALÓDI assertok: prompt (szerver builder), imageSize, numImages, loraPath = a szerver
   értéke (a kliens hamis `https://evil.example/fake.bin` NEM), p_character, p_key.
3. **Replicate LoRA-ref**: `weights://` URI és `https://replicate.delivery/` URL explicit támogatva a
   tényleges training output alapján (kitalált formátumok törölve); 5 kötelező teszt (weights:// elfogadva,
   delivery URL elfogadva, ismeretlen/fál-URL/replicate-ref-visszaélés elutasítva).
4. **Scheduling-hiba teszt**: `scheduleKickMock` dob → nincs hamis 202, pontosan 1 job, nincs második
   scheduling; dokumentálva: a queued jobot a reaper később felveszi.
5. **Tesztpontosság**: minden leírt viselkedés assertálva van (lásd 2–4.).

# CHANGELOG – v0.4.2 (2026-09-23)

## Funkcionális javítások (v0.4.1 audit alapján)
1. **Galéria assetId**: `/api/gallery` külön adja `galleryItemId`-t és `assetId`-t (+mediaType,
   signed URL); az Editor/I2V **közvetlenül assetId-t** küld (thumbnail + kiválasztott állapot,
   nincs vágólap); idegen/nem létező asset → elutasítás a hold előtt (route-teszt).
2. **Easy payload**: `imageSize` (enum: square_hd/portrait_4_3/landscape_4_3) és `numImages`
   (1–4 egész) séma-szinten validálva és a payloadban megőrződik; adapterteszt bizonyítja, hogy a
   fal.ai inputban (`image_size`, `num_images`) megjelenik; ismeretlen mezők nem befolyásolják a
   promptot (a builder fix mezőlistát olvas).
3. **0018_imagegen_character_gate.sql**: DB-szintű fail-closed image_generation – karakter
   kötelező, tulajdon+active, active_version_id kötelező, aktív verzió approved + LoRA-ref;
   rpc.sql 6 új gate-teszt.
4. **Providerfüggő LoRA-validáció** (`validateLoraRef`): fal csak fal.media URL, Replicate csak
   hivatalos referencia, mock productionben tiltott, ismeretlen provider elutasítva;
   `tests/characterLora.test.ts` (mockolt Supabase): idegen/inaktív/nincs verzió/nem approved/
   mock-prod/fal URL/érvénytelen ref.
5. **Route-tesztek** (`tests/jobsRoute.test.ts`, fetch-stub): karakter nélkül 400, LoRA-hiba →
   nincs hold, sikeres injektálás 202, idegen asset hold nélkül elutasítva, INSUFFICIENT_CREDITS 402.
6. **Biztonságos képimport**: `sniffImage` használata (MIME+magic egyezés), üres fájl → FILE_EMPTY,
   álcázott → 415 FILE_CONTENT_MISMATCH; insert-hiba esetén AZONNALI Storage-visszatörlés.
7. **TTS**: duplikált `case "tts"` eltávolítva; speed 0.5–2 (finite), language engedélyezett lista,
   voice a provider-listából; adapterteszt a pontos PlayHT payloadra.
8. **Dokumentáció**: TEST_REPORT v0.4.2; parity matrix őszinte (AI Image Generator route/UI összhang).

# CHANGELOG – v0.4.1 (2026-09-23)

## FUNKCIONÁLIS javítások (v0.4.0 elutasítva – lásd audit)
1. **Karakterkonzisztens generálás** (`src/lib/jobs/characterLora.ts` új, `api/jobs/route.ts`):
   szerveroldali tulajdon- + active-ellenőrzés, `active_version_id` feloldás, `provider_model_ref`
   validálás (élesben csak URL-súlyok), **a loraPath-et MINDIG a szerver injektálja** (a kliensé
   sosem számít), hiba esetén nincs kreditfoglalás. A „karakter nélkül” opció törölve (UI + API).
2. **Valódi Easy Mode** (`src/lib/promptBuilder.ts` új): scene/outfit/location/pose/cameraAngle/
   lighting/visualStyle mezőkből DETERMINISZTIKUS prompt builder (kliens: előnézet, szerver: végleges),
   + aspect ratio és numImages. Expert mód változatlan.
3. **Image Editor**: saját feltöltés (`api/assets/import` új – privát assets bucket, tulajdon+SHA) vagy
   galéria-asset; a szerver ellenőrzi a tulajdont, signed URL-t ad (10 perc), külső URL-nél SSRF;
   üres bemenet → elutasítás a kreditlevonás előtt; a provider megkapja az `imageUrls`-t.
4. **Image-to-Video**: kötelező, ellenőrzött forráskép (asset→signed URL vagy SSRF-szűrt URL),
   duration + aspect ratio + motion prompt; eredmény a galériába, hold/charge/refund változatlan.
5. **TTS**: szerveroldali voice-lista (`TTS_VOICES`) + voice selector + sebesség; ismeretlen voice →
   400 a kreditlevonás előtt; fal mapping voice/speed/language-gyel.
6. **Admin biztonság**: provider választó (fal|replicate, nincs hardcode), kétlépcsős megerősítés
   (window.confirm + indoklás), a restart confirmNotRunning-ja csak megerősítés után, minden
   művelet továbbra is idempotens + auditált (RPC), Admin menü csak adminnak (role a szerverről).
7. **Provider-státusz** (`api/config/provider` új): dinamikus badge (fal/Replicate/Mock/nincs) –
   titok nem megy ki.
8. **Tesztek**: `tests/promptBuilder.test.ts` (determinizmus, sorrend, üres), payload-validáció
   bővítve (image_edit/i2v/tts voice), lora-injektálás a route-ban (integration=INTEGRATION=1).

# CHANGELOG – v0.4.0 (2026-09-23)

## M4 – első Fannabe-paritás fejlesztési szakasz (UI)
- **`src/app/(app)/generate/page.tsx` (új)**: AI Image Generator Easy/Expert móddal (prompt, seed,
  steps, numImages, méret); kizárólag aktív karakterrel; a `/api/jobs`-on keresztül megy, szintén
  szerver-oldali aktív-karakter kapuval.
- **`src/app/(app)/tools/page.tsx` (új)**: AI eszközök – működők (Image Editor, Image-to-Video, TTS –
  fal adapter) + őszinte BLOCKED állapotok (Image-to-Prompt, Character Swap, Skin/Fix Face, Upscale,
  Background Removal) kamu futtatás nélkül.
- **`src/app/(app)/admin/page.tsx` (új)**: admin munkaasztal – submission_uncertain jobok reconcile
  műveletekkel (mark_failed / restart / mark_submitted) + auditált kreditmódosítás.
- Sidebar: Generator, AI Tools, Admin menüpontok.
- `docs/TEST_REPORT.md`: v0.3.6 → v0.3.8 verziószám-javítás.

# CHANGELOG – v0.3.8 (2026-09-23)

## CI env-scope és dupla-futtatás javítása
- **A v0.3.7 hibája**: a „Integrációs lefedettség-ellenőrzés" lépés NEM kapta meg az `INTEGRATION=1`-et
  (GitHub Actions step-env nem öröklődik), így a második futásban minden integrációs teszt skipelődött –
  a saját skip-ellenőrzés pirossá tette a jobot; a tesztek ráadásul kétszer futottak.
- **Javítás**: EGYETLEN futás (`Teljes DB/integrációs tesztcsomag`) a teljes env-vel, JSON riporttal
  (`--reporter=json --outputFile=/tmp/integration-report.json`). A „|| true" ELTÁVOLÍTVA – a Vitest
  hiba nem rejtőzhet el.
- **Riport-ellenőrzés** (nem futtat újra tesztet): JSON-ből `numFailedTests === 0`, skipped === 0,
  4 fájl jelenléte (mockFlow, submissionUncertain, trainingPrep, adminReconcile); hiányos/hibás JSON → piros.

# CHANGELOG – v0.3.7 (2026-09-23)

## CI-lefedettségi hiba javítása + dokumentáció-pontosítás
1. `.github/workflows/ci.yml` db job: az integrációs parancs `npx vitest run tests/integration
   tests/adminReconcile.test.ts` – az admin reconcile integrációs blokkja így már lefut; az
   INTEGRATION=1 és az összes Supabase env változatlan.
2. Új CI-lépés „Integrációs lefedettség-ellenőrzés": külön bizonyítja, hogy a 4 tesztfájl
   (mockFlow, submissionUncertain, trainingPrep, adminReconcile) lefutott és 0 skipped van –
   hiány vagy skip esetén a lépés (és a job) piros.
3. `docs/TEST_REPORT.md`: Edge Runtime warning pontosítva – tiszta buildben reprodukálható,
   nem blokkoló, import trace: @supabase/supabase-js → @supabase/ssr createBrowserClient →
   src/lib/supabase/middleware.ts; „nem reprodukálható" állítás eltávolítva.
4. `FANNABE_PARITY_MATRIX.md`: DONE / „unit+E2E+DB" jelölések eltávolítva – amíg nincs zöld db
   Actions-futás, „implementálva, CI DB NOT RUN" / „PARTIAL – verification pending" állapotú.

# CHANGELOG – v0.3.6 (2026-09-23)

## Dokumentációs és átadási javítások (kód a v0.3.5-höz képest nem változott)
1. **CHANGELOG.md**: minden verzió (v0.2.7 … v0.3.6) konkrét fájlokkal, javításokkal és tesztekkel.
2. **FANNABE_PARITY_MATRIX.md**: fejléc v0.3.6-ra frissítve.
3. **Supabase Edge Runtime warning**: ISMERT, NEM BLOKKOLÓ – dokumentálva. A Node-API-t használó
   route-okon `export const runtime = "nodejs"` megvan; a warning helyi buildben nem reprodukálható
   (compile sikeres, 26/26 oldal). „Fixed" állítás nincs.
4. **docs/TEST_REPORT.md**: LOCAL / CI DB / LIVE bontás; CI DB és LIVE szakasz NOT RUN (commit hash,
   Actions-link, Vercel URL ebből a környezetből nem szolgáltatható – kitalált érték nem szerepel).

# CHANGELOG – v0.3.5 (2026-09-20)

## Két kritikus kódhiba javítása (független audit alapján)
- `src/server/jobs/runJob.ts`: a „provider elfogadta, de a feldolgozás közben hiba" ág
  `submission_uncertain` mentése az eredeti `error.message`-szel és `recovery` mezővel történik –
  a `tests/integration/submissionUncertain.test.ts` error-ellenőrzése így valóban teljesül.
- `tests/integration/submissionUncertain.test.ts`: racing-adapter `submit: async (p)` unused
  paramétere eltávolítva (`submit: async () =>`) – lint 0 warning.
- Tesztelés: teljes sor (npm ci/lint/typecheck/test/build/audit) exit 0 – 60 passed / 9 skipped.

# CHANGELOG – v0.3.4 (2026-09-20)

## Integrációs/DB-tesztjavítások (v0.3.3 független ellenőrzése alapján)
- `.github/workflows/ci.yml`: `NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY` a GITHUB_ENV-be és az
  integrációs lépés env-jébe; `setup-cli` rögzített verzió **2.15.8**.
- `tests/integration/submissionUncertain.test.ts`: mkJob NEM állít előre submission-flaget
  (korai return megszüntetve); 2. forgatókönyv **valódi record-RPC race** (a submit végén párhuzamos
  writer rögzít → record false → catch → uncertain; bizonyítva error.message + megmaradt race-ID +
  admin mark_submitted).
- `tests/integration/trainingPrep.test.ts`: valódi JPEG-feltöltés references bucketbe, ~3×3,2 MB →
  ZIP > 8 MB → imagesZipUrl ág; ZIP a claim előtt létrejön; második prep TRAINING_ALREADY_ACTIVE után
  a második ZIP eltűnik; pontosan 1 kötött verzió – nincs árva sor.
- `tests/db/rpc.sql`: valós-provider fixture nem közvetlen insert – `claim_character_version` →
  `create_job_with_hold(versionId)` → szabályos finalizing → `complete_job_transactional`; bizonyítva:
  1 verzió, kötött, test_pending, tényleges provider + job ID + weights; kötésvédelem két létező jobbal.

# CHANGELOG – v0.3.3 (2026-09-20)

## DB/integrációs tesztcsomag-javítások (v0.3.2 független ellenőrzése alapján)
- `tests/db/rpc.sql`: régi 2-paraméteres `claim_character_version` → új 6-paraméteres (version_id a
  jsonb-ből); verzió–job kötés-teszt FK-sértését (23503) és unique-sértést külön elkapja (a fájlt nem
  állítja le).
- `tests/integration/submissionUncertain.test.ts` 2. forgatókönyv: egységesített üzleti viselkedés –
  record-RPC-hiba esetén uncertain a meglévő provider_job_id megőrzésével.
- `src/app/api/characters/[id]/training-prep/route.ts`: `datasetPath` a try ELŐTT – claim-/DB-/
  provider-hiba esetén is törlődik a ZIP; új `tests/integration/trainingPrep.test.ts`.
- `src/lib/admin/reconcileInput.ts`: nem használt `import { z }` eltávolítva.
- `tests/adminReconcile.test.ts`: integrációs blokk `describe.skipIf(!ENABLED)` (korai return helyett).

# CHANGELOG – v0.3.2 (2026-09-20)

## Futási hiba + verzió–job kötés + claim-race + ZIP-életciklus + reconcile-tesztek
- `src/server/jobs/runJob.ts`: submit-hiba útvonal tényleges kiinduló állapota `submitted` →
  `submission_uncertain`; `mustUpdate` DB-hiba/sor-szám/elvárt állapot ellenőrzéssel; hangos hiba.
- `supabase/migrations/0016_version_job_binding.sql`, `0017_version_fk_lifecycle.sql`:
  `character_versions.generation_job_id` FK + UNIQUE; életciklus `prepared/training/test_pending/
  approved/failed/expired`; `claim_character_version` v3 (advisory lock + újracheck + idempotens kulcs);
  `create_job_with_hold` kötelező `versionId`, versenyhelyzetbiztos kötés; a flow kizárólag a kötött
  verziót írja; teljes overload-tisztítás.
- `training-prep` v2: sorrend-javítás, provider a routerből, atomi claim, hibaág-takarítás,
  konfigurálható signed-URL TTL.
- Reconcile: atomi auditált RPC-k (`admin_mark_submitted/mark_failed/restart`); exportált
  `parseReconcileInput`; route- és RPC-tesztek.
- Storage: dataset-ZIP törlése siker/hiba esetén; purge route `zipsPurged`.
- Tesztek: `tests/integration/submissionUncertain.test.ts` (3 szcenárió), `tests/adminReconcile.test.ts`,
  `tests/trainingSniff.test.ts`, rpc.sql bővítés.

# CHANGELOG – v0.3.1 (2026-09-20)

## v0.3.0-beli független ellenőrzés alapján javítva
- 2 typecheck-hiba (`VersionRow.provider_model_ref`, training-prep relation-típus) + 1 lint warning
  (unused import) javítva; a teljes 11 pontos jegyzék: submitted→uncertain (SQL+TS), mustUpdate-
  keményítés, hangos uncertain-hiba, reaper-exklúzió (`0015_reconcile_v2.sql` + reaper v2),
  reconcile v2 atomi RPC-k, tényleges provider/weights mentése (`0014_training_weights.sql`),
  egységes dataset-mező XOR, dataset-biztonság, atomi `claim_character_version` (`0016`),
  overload-drop, bővített DB/integrációs tesztek.

# CHANGELOG – v0.3.0 (2026-09-20)

## Karakterfolyamat-javítások + keményített submission/recovery
- `src/lib/trainingDataset.ts` (új): store-method ZIP + CRC32 – valódi dataset a jóváhagyott refekből.
- `api/characters/[id]/training-prep` (új): dataset + SZERVEROLDALI destination; keményítés:
  magic-byte, kumulatív korlát, signed URL nagy datasetre.
- `0013_submission_uncertain.sql` (új): `submission_uncertain` állapot; `identity_check` csak nem-mock
  providerrel; `runJob` catch: nincs auto-refund/auto-resubmit; `api/admin/jobs/reconcile` (új).
- Mock-ból igazolatlan jobtípusok kiszedve (BLOCKED/503 őszintén); UI bekötés (training-prep, auto
  LoRA-ref, mock identity tiltva); `tests/trainingDataset.test.ts`, `tests/submissionUncertain.test.ts`;
  `FANNABE_PARITY_MATRIX.md` (új).

# CHANGELOG – v0.2.9 (2026-09-19)

## Hivatalos fal.ai aláírás-formátum + ledger v2 + payload-validáció
- **fal.ts**: a signed message a HIVATALOS `requestId\nuserId\ntimestamp\nsha256Hex(rawBody)` formátum;
  az aláírás **HEX** dekódolású (nem Base64); a `FAL_WEBHOOK_SECRET` teljesen eltávolítva (JWKS-publikus kulcs
  hitelesít, nincs shared secret); hiányzó header / lejárt timestamp / JWKS-hiba = fail-closed.
- **0012_submission_ledger_v2.sql**: `begin_provider_submission(job)` atomi JSONB-flag mutex – két párhuzamos
  workerből PONTOSAN EGY nyer; `record_provider_submission(job, provider, id, meta)` a **TÉNYLEGESEN**
  használt adaptert (failover után is helyes) írja be, csak ha még nincs provider_job_id.
- **runJob.ts**: bizonytalan submit-timeout után NINCS automatikus újraküldés – ha a submit befutott
  (van provider_job_id), a webhook folytatja; ha nem, refund + emberi ellenőrzés (a flag blokkolja az auto-resubmitet).
- **registry**: productionben a MockProvider SEMMILYEN kapcsolóval nem engedélyezhető (a korábbi
  `PROVIDER_ALLOW_MOCK_PRODUCTION` override törölve).
- **validation.ts**: jobtípusonkénti payload-validáció (Zod superRefine) – tréning destination+imagesDataUrl,
  reference_qc refIds-tömb, prompt/imageUrl/videoUrl/audioUrl/text mezők; 400 a kreditlevonás előtt.
- **Tesztek**: fal verify a hivatalos \n-formátummal HEX aláírással (külön tesztkulcspár + JWKS-stub),
  `tests/jobPayloadValidation.test.ts` (új), integrációs ledger-race (Promise.all-ből pontosan 1 nyer,
  record dupla tiltva, tényleges provider az adatbázisban), rpc.sql ledger v2 aláírásokkal.
- **Edge Runtime warning**: `export const runtime = "nodejs"` minden Node-API-t használó route-on.

# CHANGELOG – v0.2.8 (2026-09-19)

## Hivatalos fal.ai webhook + submit-idempotencia + production mock-tiltás
- **fal.ts**: `fal_webhook` query-param (helyes, nem `fal_webhook_url`); válaszból tárolt `cancel_url`;
  hivatalos webhook – `X-Fal-Webhook-Request/User/Timestamp/Signature` headerek,
  `v1:{request_id}.{timestamp}.{sha256hex(body)}` signed message, **Ed25519 + JWKS**
  (`rest.fal.ai/.well-known/jwks.json`, cache 24 h), ±5 perc timestamp-ablak, fail-closed;
  státusz **OK→done / ERROR→failed**, kimenet a `payload` mezőből közvetlenül; `request_id` = stabil eseményazonosító.
- **0011_submission_ledger.sql**: `begin_provider_submission` / `record_provider_submission` – egy job SOHA
  ne indítson két fizetős provider-jobot (timeout/retry/reaper esetén sem); a ledger a `provider_job_id` NULL-ja.
- **runJob.ts**: submit előtt ledger-claim; ha már van `provider_job_id` → NEM submitol újra, hanem resume.
- **registry**: productionben a MockProvider SOHA nem kerül be (még kulcs mellett sem);
  `PROVIDER_ALLOW_MOCK_PRODUCTION=true` külön veszélyes override.
- **webhook route**: `await` verify (JWKS), hitelesített header eseményazonosító-fallback,
  `norm.output` közvetlen feldolgozása; **cron recovery**: `provider_meta` + jobType átadás a getResult-nek.
- **replicate.ts**: igazolatlan `whisper-sync` törölve; async verify + hiányzó header fail-closed.
- **jobs route**: tréning payload-validáció (destination + imagesDataUrl) létrehozás előtt – 400, kredit nélkül.
- **runtime**: `export const runtime = "nodejs"` a Node-API-t használó route-okon (Edge warning javítva).
- **live smoke**: teljesen átírva – valódi aszinkron submit → status_url poll → response_url → letöltés.
- **CI**: `workflow_dispatch` esemény; `npm audit --omit=dev` a verify-ban; nem-destruktív lockfile-check.
- **tesztek**: új fal-fixture-ök (Ed25519 kulcspárral aláírt JWKS-stub, lejárt timestamp, hiányzó header,
  OK/ERROR payload, cancel_url), production mock-hiány kulcs mellett, header-event-id fallback,
  rpc.sql ledger-teszt (dupla submit-jog/record elutasítva).
- **őszinte megjegyzés**: az Ed25519 message-formátum és a JWKS ellenőrzés a dokumentált sémák szerint
  készült, de élő fal-traffictól még nem validáltuk – a TEST_REPORT-ban „implementált, élőben nem igazolt".

# CHANGELOG – v0.2.7 (2026-09-19)

## Provider-, webhook-, queue- és integrációs javítások

### src/lib/providers/fal.ts – ÚJRAÍRVA (a v0.2.6-os helyőrző helyett)
- **Mit**: hivatalos fal.ai Queue API REST-séma. Submit: `POST https://queue.fal.run/{endpoint}?fal_webhook_url=…`
  → válasz `{request_id, status_url, response_url}`; státusz/eredmény a **tárolt meta-URL-eken** kerül lekérdezésre
  (a meta az endpoint-tal együtt marad meg). Per-modell input/output mapper (`MODELS` tábla):
  flux-lora-fast-training (images_data_url), flux-lora (loras/loraPath), nano-banana-pro/edit,
  kling i2v, sync-lips, playht tts. Hibatípus-taxonómia: 429 rate_limit (retry), 401/403 auth (non-retry),
  400/422 invalid_input (non-retry), 5xx outage (retry) – `ProviderError.category`-vel.
- **Melyik hibát javítja**: a v0.2.6-os verció nem a dokumentált query-paraméteres webhookot használta, nem tárolta
  a status/response URL-eket, és nem különböztette meg a hibatípusokat.
- **Hogyan teszteltem**: `tests/providerAdapters.test.ts` – fetch-stub fixture-ökkel: submit URL + webhook query,
  status meta-URL-ből, result normalizálás, 429/401 osztályozás, fal-signature HMAC verify (helyes/rossz/hiányzó),
  request_id mint stabil event ID, hiányzó meta érthető hiba.
- **Parancs**: `npm test -- providerAdapters` (lefutott: fal-esetek zöldek).
- **Valódi szolgáltatóval működik?**: a séma a hivatalos API szerinti; **valódi kulcsos futtatás még nem történt**
  (LIVE smoke kész, `LIVE=1 + FAL_KEY` – jóváhagyásra vár).

### src/lib/providers/replicate.ts – ÚJRAÍRVA
- **Mit**: dokumentált REST. Predikciók: `POST /v1/models/{owner}/{model}/predictions`, státusz/eredmény
  `GET /v1/predictions/{id}`, cancel `POST …/cancel`. **Tréning a hivatalos training flow-val**:
  `POST /v1/models/ostris/flux-dev-lora-trainer/trainings` (`{input, destination, webhook}`) → training ID;
  eredmény: `GET /v1/trainings/{id}` → weights URI (meta, nem fájl). Webhook: Standard Webhooks
  (webhook-id/timestamp/signature) **svix-verifikációval**, ~5 perc időablak. `res.ok` minden hívásnál;
  hibatípus-taxonómia ugyanaz.
- **Melyik hibát javítja**: a v0.2.6-os verzió predikció-végpontra küldte a tréninget, hamis healthCheck-et
  használt, és nem volt timestamp-ablakos webhook-ellenőrzés.
- **Hogyan teszteltem**: fixture-tesztek: prediction submit/status/result/cancel, training flow (destination a body-ban,
  webhook URL), training result weights-meta, Standard Webhooks helyes/hamis/lejárt timestamp, 422/500 osztályozás.
- **Parancs**: `npm test -- providerAdapters` (lefutott: replicate-esetek zöldek).
- **Valódi szolgáltatóval működik?**: séma szerint készült; valódi futtatás jóváhagyásra vár (nem nevezzük késznek).

### src/lib/providers/types.ts – interfész-bővítés
- `SubmitResult.providerMeta`, `getStatus/getResult/cancel` opcionális meta-paraméterrel,
  `verifyWebhook(rawBody, headers: Record<string,string|null>, secret)` (minden headerrel),
  `ProviderErrorCategory` (rate_limit/auth/invalid_input/outage/unknown).

### src/lib/providers/mock.ts – verifyWebhook új aláírás
- header-map alapján (`x-castora-signature`), hossz-ellenőrzés mellett timing-safe.

### src/app/api/webhooks/provider/[name]/route.ts – újraírva
- **Mit**: szolgáltatónkénti sémák; MINDEN releváns header az adapternek; **aláírás-ellenőrzés ELŐSZÖR**,
  replay-védelem (webhook_events unique) csak érvényes eseményre – így hibás aláírással nem lehet az
  eseményazonosítót lefoglalni (pre-registration támadás kizárva). Terminal állapotú job: idempotens no-op.
- **Melyik hibát javítja**: a korábbi verzió a replay-sor rögzítését az aláírás-ellenőrzés ELÉ tette.
- **Hogyan teszteltem**: `tests/webhook.test.ts` + adapter-tesztek (fal-signature, svix hamis/lejárt).

### src/lib/providers/index.ts – production fail-closed
- **Mit**: kulcs nélkül productionben a router üres – a job API `NO_PROVIDER_CONFIGURED` → 503 a kreditlevonás előtt;
  mock csak dev-ben vagy `PROVIDER_ALLOW_MOCK=true`-val. `assertProviderConfigured` a jobs route-ban.
- **Hogyan teszteltem**: `tests/providerAdapters.test.ts` „production fail-closed" eset (0 kandidátus kulcsok nélkül).

### src/server/jobs/runJob.ts – provider_meta tárolás
- Submit után a `provider_meta` (endpoint/status/response URL) a job sorába kerül (0010 migráció),
  a webhook-státusz/eredmény-lekérés ebből dolgozik.

### supabase/migrations/0010_provider_meta.sql – ÚJ
- `generation_jobs.provider_meta jsonb`.

### tests/ – új és javított
- `tests/providerAdapters.test.ts` – ÚJ, 15 eset (fent).
- `tests/live/smoke.test.ts` – ÚJ, `LIVE=1 + FAL_KEY` mellett valódi schnell-generálás + letöltés-ellenőrzés.
- `tests/mockProvider.test.ts` – az új verifyWebhook aláíráshoz igazítva.
- `tests/providerAdapters.test.ts` javítások ebben a körben: training webhookUrl, svix sign Date,
  fail-closed env-tisztítás `delete`-tel (a `= undefined` stringgé állt volna).

### docs – ÚJ: CHANGELOG.md (ez), PROVIDERS.md, ENVIRONMENT.md, DEPLOYMENT.md, SECURITY.md,
API-KEYS.md (a brief 12. pontja szerinti teljes táblázat), DATABASE.md (ERD), ROUTES.md.

### .github/workflows/ci.yml – smoke job
- `workflow_dispatch`-re indítható LIVE smoke (secrets.FAL_KEY).

## Lefutott parancsok ebben a körben
`npm run lint` ✅ · `npm run typecheck` ✅ · `npm test` (a 3 javítás utáni újrafutással – cél 41/41;
a futás eredménye a következő körben zárójelben) · `npm run build` · `npm audit --omit=dev`.

## Mi maradt hátra (őszinte)
1. Valódi kulcsos futtatás: LIVE smoke + tréning/generálás mérés – kulcsjóváhagyás kell (API-KEYS.md).
2. Supabase/GitHub/Vercel bizonyíték: push + első Actions-futás + deploy (e környezetben nincs Docker/GitHub).
3. A Fannabe-szintű teljes funkciólista (Image Editor, Video, Talking, Viral, Niche, Carousel, PPV,
   teljes Galéria, Admin felület): M3+ mérföldkövek – külön ütemezés és kulcsok kellenek.
4. MOCK motor: kizárólag dev/teszt; productionben tilos (fail-closed).
