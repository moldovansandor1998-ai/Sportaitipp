# TEST REPORT – Castora v0.5.2 (2026-09-23)

## LOCAL (tiszta munkakönyvtár, valódi futás)
| Parancs | Exit code |
|---|---|
| `npm ci` | 0 |
| `npm run lint` | 0 (0 error, 0 warning) |
| `npm run typecheck` | 0 |
| `npm test -- --run` | 0 – **24 fájl passed / 4 skipped (28); 117 teszt passed / 0 failed / 9 skipped (126)** |
| `npm run build` | 0 |
| `npm audit --omit=dev` | 0 – found 0 vulnerabilities |

## Ez a kör (v0.5.2) – bizonyított javítások
- **projectId teljes útja** – RPC-stub rögzíti a tényleges `p_project`-et: saját projekt továbbmegy
  (a route RPC-paraméterében pontosan a küldött ID), idegen → 403 hold nélkül, hibás UUID → 400,
  projectId nélkül → `p_project: null`; estimate: nincs job/hold/módosítás;
- **Kliens loraPath teljes kizárása** – a prep elején törlődik, csak szerveroldali feloldás után kerül vissza;
- **Poller versenyhelyzet** – inFlight + generation token (stop/stopAll után az eredmény elvetve), 3 új teszt;
- **Attempt-kulcs életciklus** (4 teszt), **I2V ár** (megjelenítés + frissítés + hiba esetén nem indul),
  **job-result bucket az assetből** (custom-bucket teszt), lint 0 warning (stabil useCallback-ök).

## Skipped (9) – dokumentált kapuk
mockFlow (2) · submissionUncertain (4) · trainingPrep (1) – INTEGRATION=1+Supabase; smoke (1) – LIVE=1+FAL_KEY;
adminReconcile integrációs blokk (1) – INTEGRATION=1+Supabase.

## NOT RUN (bizonyíték nélkül – PASS-tilos)
GitHub Actions, Supabase DB, INTEGRATION=1, Vercel Preview, Playwright, LIVE provider.

## Státusz
**PARTIAL – local code verified, deployment/live verification pending.** A nyolc „Hamarosan" eszköz BLOCKED.
