# Castora

Saját márkájú, clean-room AI-karakterplatform – a SportAI Tipptől és minden más projekttől teljesen függetlenül, nulláról.

## Stack
- Next.js 15 (App Router) + TypeScript + React 19
- Supabase: Auth (e-mail + Google), PostgreSQL, privát Storage, RLS minden publikus táblán
- Resend: tranzakciós e-mailek (idempotensen, suppression-tisztelő)
- Provider-független AI-adapterréteg – jelenleg **Mock motorral** fut a teljes folyamat; éles provider (fal.ai, Replicate, RunPod, Wavespeed) utólag, felületi változás nélkül cserélhető

## Indítás
1. `cp .env.example .env` – értékek kitöltése (staging és production külön Supabase-projekt!)
2. `supabase link` + `supabase db push` (a 3 migráció üres adatbázison fut)
3. `npm install`
4. `npm run dev`

## Ellenőrzések
`npm run typecheck && npm run lint && npm test && npm run build`

## Első vertikális folyamat (működik mock motorral)
regisztráció (ÁSZF/adatkezelés/18+) → karakter létrehozása → referenciafeltöltés (aláírt URL, privát bucket) → referencia-QC → LoRA-tréning job → tesztkép → azonosság-ellenőrzés → képgenerálás → eredmény saját Storage-ba → galéria → atomi kreditelszámolás (hold → charge / egyszeri refund) → Resend-értesítés

## Állapotgép
draft → awaiting_credit → queued → submitted → processing → quality_check → completed · retrying · failed → refunded · cancelled

Minden átmenet adatbázis-triggerrel kényszerítve és unit-tesztelve.
