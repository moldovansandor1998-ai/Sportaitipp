# TEST REPORT – Castora v0.7.1 (2026-09-25)

## LOCAL (teljes forrásfa, valódi futás – külön naplózott exit code)
| Parancs | Exit |
|---|---|
| `npm ci` | 0 |
| `npm run lint` | 0 (0 error, 0 warning) |
| `npm run typecheck` | 0 |
| `npm test -- --run` | 0 – **182 teszt: 173 passed / 0 failed / 9 skipped / 0 todo** |
| `npm run build` | 0 |
| `npm audit --omit=dev` | 0 – found 0 vulnerabilities |

## Tesztfájlok: 36 (32 passed + 4 env-kapus skipped)
Eltűnt/átnevezett/todo teszt nincs (JSON-riport per-file bontása alapján).

## v0.7.1 javítások + bizonyítékok
- Stripe verify-first + tranzakciós RPC, külön metadata mezők és ellenőrzött purchase-mentés;
- kredit RPC-hibák fail-closed; valódi carousel SHA-256 + gallery rekord;
- album/tulajdon válaszszintű regressziós tesztek (`all`, nincs album, saját/idegen/hibás album);
- ban-végrehajtás, plans RLS/grants, karakter/Pinterest/Motion UI és projektátnevezés;
- Reels/Trends/Niche konfigurált szöveges AI-val, hiányzó provider esetén 503 hold előtt.

## Lockfile
`npm install --package-lock-only --no-audit` npm 11.9.0-val → byte-azonos.
Verziók szinkronban (0.7.1 ×3). A teljes helyi sor Node 22.23.3 + npm 11.9.0 alatt futott.

## Éles infrastruktúra
- Supabase production: migrációk 0001–0025 alkalmazva; szabálytáblák RLS-e aktív; anonim
  `is_admin()` végrehajtás visszavonva.
- Vercel production deployment: READY; `sportaitipp.vercel.app/login` 200; védett
  `/dashboard` anonim látogatót `/login?next=%2Fdashboard` címre irányít; `/api/projects` 401.
- A `.com`/`.hu` egyedi domainek Vercelben `Invalid Configuration` állapotúak, DNS-javítás szükséges.
- A szerveroldali Supabase secret Vercel-beállítása külön adminműveletként még szükséges.

## NOT RUN (bizonyíték nélkül – PASS-tilos)
GitHub Actions, Supabase CLI `db reset`, INTEGRATION=1 (0 failed/0 skip),
teljes hitelesített böngészős E2E, **LIVE: Stripe-valós fizetés, fal.ai valódi generálás/tréning,
Resend élő küldés** – kulcsokhoz kötöttek.

## Státusz
LOCAL SOURCE VERIFICATION PASSED – SUPABASE + VERCEL BASE DEPLOYED; SECRET/DNS/PROVIDER LIVE PENDING.
