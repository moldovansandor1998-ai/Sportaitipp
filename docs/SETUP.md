# Telepítés – staging és production (külön Supabase-projekt mindegyikhez)

## 1. Supabase (staging, majd production külön)
1. Új projekt → régió: eu-central
2. SQL Editor helyett: `supabase link --project-ref <ref>` → `supabase db push` (3 migráció)
3. Auth → Providers: Email (Confirm email: ON), Google (Client ID/Secret)
4. Auth → URL Configuration: Site URL = https://staging.castora.hu, Redirect = /auth/callback
5. Ellenőrzés: `supabase db reset` üres adatbázison hibamentesen lefut

## 2. Vercel
1. Import GitHub repo → Root: . → Framework: Next.js
2. Environment variables (staging scope): NEXT_PUBLIC_SUPABASE_URL/ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, APP_URL, PROVIDER_WEBHOOK_SECRET, RESEND_API_KEY, EMAIL_FROM, RESEND_WEBHOOK_SECRET, NEXT_PUBLIC_ASSET_HOST
3. Production scope: külön Supabase-projekt értékei
4. Protection: production deploy csak main-ről, sikeres CI után

## 3. Resend
1. Domain hozzáadás (castora.hu) → SPF + DKIM rekordok
2. API key → RESEND_API_KEY (server-only)
3. Webhook: /api/webhooks/resend → RESEND_WEBHOOK_SECRET

## 4. Storage
- A migráció létrehozza a privát `references` és `assets` bucketet – nyilvánossá tenni TILOS
- Megjelenítés kizárólag createSignedUrl-lel (1 óra lejárat)

## 5. Branchek
main (production) ← staging ← feature/* ; PR minden feature-be, CI-zöld + preview kötelező
