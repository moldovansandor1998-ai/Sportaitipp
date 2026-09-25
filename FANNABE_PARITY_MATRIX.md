# Fannabe-paritás mátrix (2026-09-25, v0.7.1)

Státuszok: **DONE** (kész, tesztelve) · **PARTIAL** (működik, mock vagy alap) · **BLOCKED** (nincs igazolt valódi provider/kulcs – ideiglenes, következő mérföldkövekben épül)

| Funkció (brief) | Route/UI | API | DB | Provider | Kredit | Teszt | Státusz |
|---|---|---|---|---|---|---|---|
| Regisztráció/login/Google | ✅ | ✅ | ✅ | Supabase Auth | – | unit | implementálva, CI DB NOT RUN |
| Korhatár/ÁSZF/privacy | ✅ | ✅ | ✅ | – | – | unit | DONE |
| AI Character Builder (referencia→QC→tréning→tesztkép→identity→active) | ✅ | ✅ | ✅ | mock; éles: fal/Replicate | ✅ | unit + DB/integráció készen | PARTIAL – verification pending |
| – valódi referencia-QC (arc/homály/dup) | ⬜ | ⬜ | ✅ | külön QC modell kell | ✅ | – | BLOCKED (M3) |
| – valódi LoRA-tréning (fal flux-lora-fast-training / Replicate training) | ✅ gomb | ✅ training-prep | ✅ 0014 weights | fal/Replicate | ✅ | fixture | BLOCKED – kulcs kell |
| – identity_check | ✅ (mock-tiltva) | ✅ kapu | ✅ | valódi only | ✅ | unit | BLOCKED – valódi provider |
| Easy Mode képgenerálás | ✅ TELJES | ✅ | ✅ | fal flux-lora | ✅ (estimate) | unit (builder/route) | PARTIAL – valódi futás CI LIVE-ban |
| Expert Mode (neg./seed/steps/guidance) | ✅ TELJES | ✅ | ✅ | fal | ✅ (estimate) | unit + route | PARTIAL – valódi futás CI LIVE-ban |
| AI Image Generator | ⬜ | ✅ | ✅ | fal/Replicate | ✅ | fixture | PARTIAL (M3 UI) |
| Image-to-Prompt | ✅ | ✅ | ✅ | fal-ai/imageutils/caption | ✅ (estimate) | unit | PARTIAL – valódi futás CI LIVE-ban |
| Character Swap | ✅ | ✅ | ✅ | fal-ai/face-swap | ✅ (estimate) | unit | PARTIAL – valódi futás CI LIVE-ban |
| AI Image Editor | ✅ | ✅ | ✅ | fal nano-banana | ✅ | unit (input) + integration | PARTIAL – valódi futás CI LIVE-ban |
| Skin Enhancer / Fix Face | ✅ | ✅ | ✅ | nano-banana preset | ✅ (estimate) | unit | PARTIAL – valódi futás CI LIVE-ban |
| Upscale | ✅ | ✅ | ✅ | fal-ai/esrgan | ✅ (estimate) | unit | PARTIAL – valódi futás CI LIVE-ban |
| Background Removal | ✅ | ✅ | ✅ | fal-ai/birefnet | ✅ (estimate) | unit | PARTIAL – valódi futás CI LIVE-ban |
| Video-to-Video | ✅ | ✅ | ✅ | fal-ai kling v2v | ✅ (estimate) | unit | PARTIAL – valódi futás CI LIVE-ban |
| Image-to-Video | ✅ TELJES | ✅ | ✅ | fal kling | ✅ (estimate) | unit | PARTIAL – valódi futás CI LIVE-ban |
| Talking Video | ✅ | ✅ | ✅ | fal-ai/sync-lips | ✅ (estimate) | unit | PARTIAL – valódi futás CI LIVE-ban |
| Lip Sync + TTS | ✅ | ✅ | ✅ | fal-ai/sync-lips · playht | ✅ (estimate) | unit | PARTIAL – valódi futás CI LIVE-ban |
| Viral Reels Copy | ✅ | ✅ | ✅ | OpenAI-kompatibilis | ✅ | unit | PARTIAL – provider/live pending |
| Viral Trends Generator | ✅ | ✅ | ✅ | OpenAI-kompatibilis | ✅ | unit | PARTIAL – provider/live pending |
| Niche Generator | ✅ | ✅ | ✅ | OpenAI-kompatibilis | ✅ | unit | PARTIAL – provider/live pending |
| Carousel Generator | ✅ | ✅ | ✅ | SVG render | ✅ | unit | DONE local; DB deploy pending |
| Galéria (albumok/szűrés/tömegművelet) | ✅ | ✅ | ✅ | – | – | unit | PARTIAL – verification pending |
| Kreditrendszer (hold/charge/refund, admin adjust) | ✅ | ✅ | ✅ | – | ✅ | unit + DB-tesztek készen | implementálva, CI DB NOT RUN |
| Stripe fizetés/csomagok | ✅ | ✅ | ✅ | Stripe Checkout | ✅ | unit | PARTIAL – test/live payment pending |
| Resend e-mailek | ✅ beállítás | ✅ webhook | ✅ | Resend | – | fixture | PARTIAL – élő igazolás |
| Content Calendar | ✅ | ✅ | ✅ | – | – | unit | PARTIAL – verification pending |
| Admin felület (reconcile+kredit+összesítő) | ✅ | ✅ (credits, reconcile, summary) | ✅ | – | ✅ | unit | PARTIAL – verification pending |
| Queue/webhook/ledger/reaper | ✅ | ✅ | ✅ 0008–0014 | mind | ✅ | unit + DB-tesztek készen | implementálva, CI DB NOT RUN |
| Supabase/Vercel/GitHub CI | workflow kész | – | – | – | – | – | BLOCKED – push+futás kell |

## Bizonyítékok hiánya (őszinte)
GitHub commit/run, Vercel preview, valódi fal.ai/Replicate kép/videó/tréning/webhook, Stripe, Resend élő
küldés: kulcs- és fiókhozzáférés nélkül nem állítható elő. A `db` CI-job és a `LIVE=1` smoke a bekötés
után azonnal futtatható.
