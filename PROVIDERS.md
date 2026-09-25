# Provider-integrációk

## Általános szerződés
Minden adapter a `ProviderAdapter` interfészt implementálja (`src/lib/providers/types.ts`):
estimate / submit (idempotency-kulccsal) / getStatus / getResult / cancel / healthCheck /
normalizeWebhook / verifyWebhook. A router timeoutot, circuit breakert és failovert ad
(`router.ts`). A provider- és modellverzió a `generation_jobs.provider_meta`-ba kerül.

## fal.ai (elsődleges – FAL_KEY)
- Hivatalos **Queue API**: `POST https://queue.fal.run/{endpoint}?fal_webhook_url=…` → `{request_id, status_url, response_url}`.
- Státusz/eredmény a **tárolt URL-eken** (meta), endpoint együttes tárolásával.
- Webhook: `fal-signature` header, HMAC-SHA256 a `FAL_WEBHOOK_SECRET`-tel (konfigurációs érvényesítés a live smoke-ban).
- Modellek: `fal-ai/flux-lora-fast-training` (tréning, images_data_url zip), `fal-ai/flux-lora` (generálás),
  `fal-ai/nano-banana-pro/edit`, `fal-ai/kling-video/v2.1/master/image-to-video`,
  `fal-ai/sync-lips` (talking/lip-sync), `fal-ai/playht/tts/v3`.
- Hibák: 429 rate_limit (retry), 401/403 auth (non-retry), 400/422 invalid_input (non-retry), 5xx outage (retry).

## Replicate (tartalék – REPLICATE_API_TOKEN)
- Predikciók: `POST /v1/models/{owner}/{model}/predictions`; státusz/eredmény `GET /v1/predictions/{id}`; cancel `POST …/cancel`.
- **Tréning a hivatalos training flow-val**: `POST /v1/models/ostris/flux-dev-lora-trainer/trainings`
  (`{input, destination, webhook}`) → training ID; eredmény: `GET /v1/trainings/{id}` → weights URI (meta, nem fájl).
- Webhook: **Standard Webhooks** (`webhook-id/timestamp/signature`), svix-verifikáció ~5 perc időablakkal (replay-védelem).

## Mock motor (kizárólag fejlesztés/teszt)
`PROVIDER_ALLOW_MOCK=true` nélkül productionben **soha** nem használható; hiányzó kulcsnál a job
létrehozása `NO_PROVIDER_CONFIGURED` (503) hibával elbukik a kreditlevonás előtt. Nincs kamu completed eredmény.

## Szöveges tartalom-AI
Az OpenAI-kompatibilis chat-completions végpont a `CONTENT_AI_API_URL`, `CONTENT_AI_API_KEY` és
`CONTENT_AI_MODEL` változókkal állítható. A Reels Copy, Trends és Niche route-ok strukturált JSON-t
kérnek és Zod-sémával ellenőrzik. Hiányos konfigurációnál `CONTENT_AI_NOT_CONFIGURED` (503) érkezik
a kreditfoglalás előtt; nincs szabályalapú vagy hamis production fallback.

## Stripe
A Checkout Session metadata mezői külön form-fieldként kerülnek átadásra. A webhook a nyers body
HMAC-ellenőrzése előtt semmit nem ír. Az érvényes esemény replay-regisztrációja, a purchase/plan/user
egyezés, a kreditjóváírás és a tranzakciónapló a `process_stripe_event` DB-függvény egyetlen
tranzakciójában történik.

## Éles validálás állása (őszinte)
Az adapterek a hivatalos sémák szerint készültek és fixture-teszteltek; **valódi kulcsos futtatás
(live smoke) még nem történt meg** – a `LIVE=1 + FAL_KEY` smoke-teszt és a kulcsjóváhagyás utáni
mérések hiányoznak a „kész” minősítéshez (lásd API-KEYS.md).
