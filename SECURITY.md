# Biztonsági modell (rövid)

- **RLS** minden user-scoped táblán; kétfelhasználós teszt (`tests/db/rls.sql`).
- **Szervervezérelt mezők**: `generation_jobs` insert/update/delete csak service role; `characters`
  kliensen csak (name, description, is_spicy); `profiles` kliensről nem módosítható.
- **SECURITY DEFINER függvények** EXECUTE-ja revoke-olva public/anon/authenticated-ről, csak service role.
- **Kreditek**: atomi hold (fedezet-ellenőrzéssel), pontosan egyszeri charge/refund (idempotens SQL),
  negatív egyenleg check-constraint-tel lehetetlen; a teljes véglegesítés egy tranzakciós RPC-ben.
- **Webhookok**: szolgáltatónkénti titok + valódi sémák (fal-signature HMAC; Replicate Standard Webhooks
  svix-verifikációval, ~5 perc időablak); **aláírás először, replay-védelem utána** (nincs pre-registration).
- **SSRF**: provider-letöltés allowlist + privát tartomány-tiltás + 100 MB korlát + redirect tiltás.
- **Storage**: privát bucketek, signed URL-ek (1 óra), szerveroldali finalize MIME/méret/SHA-ellenőrzéssel.
- **Queue**: atomi claim (SKIP LOCKED), finalize lease (10 perc), reaper, fail-closed cron.
- **Érzékeny adat**: service role soha nem kerül kliensbundle-be (CI-ben is ellenőrizhető grep-pel);
  API-kulcsok csak szerveroldali env-ben (lásd ENVIRONMENT.md).

## Ismert hiányosságok (őszinte)
- Valódi provider-futtatás még nem bizonyított (kulcsok nélkül) – lásd PROVIDERS.md / API-KEYS.md.
- NSFW/CSAM detektálás emberi admin-QC-re vár (moderációs jelzők készen, automata modell nincs bekötve).
