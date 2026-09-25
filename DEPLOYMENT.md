# Telepítés és visszaállítás

## 1. Supabase (staging, majd production – külön projektek)
1. Új projekt (eu-central) → `supabase link --project-ref <ref>` → `supabase db push` (migrációk 0001–0025).
2. Auth: Email (confirm ON) + Google OAuth; URL config: Site URL = app URL, redirect `/auth/callback`.
3. `supabase db reset` – üres adatbázison minden migrációnak hiba nélkül kell futnia.

## 2. Vercel
1. Repo import (Next.js). Environment variables: lásd ENVIRONMENT.md (staging/production scope külön).
2. Production deploy csak main-ről, zöld CI után; preview minden PR-hez.
3. Hosszú AI-job **nem** HTTP-kérésben fut: `after()`-beli kick + provider webhook + `/api/jobs/process`
   cron (Vercel Cron: 5 percenként, `Authorization: Bearer $CRON_SECRET`) + reaper/lease.

## 3. Helyi fejlesztés
Node 22.22.0 és npm 11.9.0 szükséges (`.nvmrc`, `packageManager`). `npm ci && npm run dev` + `npm run test` (unit), `supabase start && supabase db reset` +
`psql -f tests/db/rls.sql -f tests/db/rpc.sql` + `INTEGRATION=1 npx vitest run tests/integration` (0 skip).

## 4. Visszaállítás (restore)
- Adatbázis: Supabase Dashboard → Database → Backups (PITR a Pro csomagtól) vagy napi dump.
- Storage: bucket-szintű snapshot / saját export (assetek privát bucketben).
- Vercel: `vercel rollback` azonnali visszaállítás az előző deploymentre.
- Titkok kompromittálódása esetén: kulcsrotation (Supabase service role, provider kulcsok, CRON_SECRET) +
  `webhook_events` + `audit_logs` átnézése.

## 5. CI/CD
GitHub Actions: `verify` (ci/lint/typecheck/unit/build/lockfile) + `db` (supabase start → reset →
psql RLS/RPC → INTEGRATION=1 E2E, 0 skip) + opcionális `smoke` (workflow_dispatch, LIVE=1 + FAL_KEY).
