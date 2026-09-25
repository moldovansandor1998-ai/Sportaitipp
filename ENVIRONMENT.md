# Környezeti változók (minden környezetben a Vercel/Supabase dashboardon állítható)

| Változó | Hol | Kötelező | Leírás |
|---|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL | mindkettő | igen | Supabase projekt URL |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | mindkettő | igen | Anon kulcs (RLS) |
| SUPABASE_SERVICE_ROLE_KEY | **csak szerver** | igen | Service role – SOHA nem kerül kliensre |
| NEXT_PUBLIC_ASSET_HOST | mindkettő | opc. | Saját asset host (next/image allowlist) |
| APP_URL | szerver | igen | Pl. https://app.castora.hu |
| CRON_SECRET | szerver | igen | /api/jobs/process és /api/purge Bearer titka |
| PROVIDER_WEBHOOK_SECRET | szerver | igen | Mock/aláíró titok a provider webhookhoz |
| FAL_KEY | **csak szerver** | M2-től | fal.ai kulcs – nélküle production fail-closed |
| FAL_WEBHOOK_SECRET | szerver | M2-éles | fal webhook HMAC titok |
| REPLICATE_API_TOKEN | **csak szerver** | opc. | Replicate tartalék provider |
| REPLICATE_WEBHOOK_SECRET | szerver | éles Replicate-nél | Standard Webhooks titok |
| CONTENT_AI_API_URL | **csak szerver** | tartalmi AI-hoz | OpenAI-kompatibilis chat-completions végpont |
| CONTENT_AI_API_KEY | **csak szerver** | tartalmi AI-hoz | Szöveges modell titkos API-kulcsa |
| CONTENT_AI_MODEL | szerver | tartalmi AI-hoz | A szolgáltatónál elérhető modellazonosító |
| STRIPE_SECRET_KEY | **csak szerver** | fizetéshez | Stripe secret key |
| STRIPE_WEBHOOK_SECRET | **csak szerver** | fizetéshez | Stripe endpoint signing secret |
| RESEND_API_KEY | **csak szerver** | éles e-mail | Hiányában az e-mail `skipped_no_key` (nem dob) |
| EMAIL_FROM | szerver | éles | Pl. "Castora <hello@castora.hu>" |
| RESEND_WEBHOOK_SECRET | szerver | éles | Svix webhook titok (bounce/complaint) |
| PROVIDER_ALLOW_MOCK | szerver | **csak dev** | `true` nélkül productionben mock tiltott |

Szabály: `NEXT_PUBLIC_`-nel csak anon kulcs megy ki; minden titok szerveroldali. Staging és
production külön Supabase-projekt és külön Vercel environment.
