# API-kulcslista (jóváhagyás előtt – a brief 12. pontja szerint)

| Szolgáltató | Hivatalos oldal | Mire | Konkrét modell | Várható költség | Env változó | Kötelező? | Szerep | Mit küldünk ki |
|---|---|---|---|---|---|---|---|---|
| fal.ai | fal.ai | Karakter-tréning (LoRA) | `fal-ai/flux-lora-fast-training` | ~$0.50–2 / tréning | `FAL_KEY` | **igen (M2)** | elsődleges | referencia-zip (feltöltött képek) |
| fal.ai | fal.ai | Képgenerálás karakterrel | `fal-ai/flux-lora` | ~$0.03–0.05 / kép | `FAL_KEY` | igen | elsődleges | prompt + LoRA-ref |
| fal.ai | fal.ai | Képszerkesztés | `fal-ai/nano-banana-pro/edit` | ~$0.05 / kép | `FAL_KEY` | opc. | elsődleges | kép + prompt |
| fal.ai | fal.ai | Kép→videó | `fal-ai/kling-video/v2.1/master/image-to-video` | ~$0.30–0.60 / videó | `FAL_KEY` | opc. | elsődleges | kép + prompt |
| fal.ai | fal.ai | Talking/lip-sync | `fal-ai/sync-lips` | ~$0.30 / videó | `FAL_KEY` | opc. | elsődleges | videó + hang |
| fal.ai | fal.ai | TTS | `fal-ai/playht/tts/v3` | ~$0.02 / lekérés | `FAL_KEY` | opc. | elsődleges | szöveg |
| Replicate | replicate.com | Tartalék tréning | `ostris/flux-dev-lora-trainer` | ~$2–5 / futás | `REPLICATE_API_TOKEN` | opc. | **fallback** | referencia-zip, destination név |
| Replicate | replicate.com | Tartalék videó | `tencent/seedance-1-pro` | ~$0.50 / videó | `REPLICATE_API_TOKEN` | opc. | fallback | kép + prompt |
| Resend | resend.com | Tranzakciós e-mailek | – | ingyenes szinttől | `RESEND_API_KEY` | élesben igen | – | címzett, sablon-adatok |
| Supabase | supabase.com | Auth/DB/Storage | – | ingyenes szinttől | `SUPABASE_*` | igen | – | felhasználói adatok (EU régió) |
| OpenAI-kompatibilis szöveges provider | providerfüggő | Reels/Trends/Niche | konfigurált modell | providerfüggő | `CONTENT_AI_API_URL`, `CONTENT_AI_API_KEY`, `CONTENT_AI_MODEL` | tartalmi AI-hoz igen | elsődleges | prompt és felhasználói tartalombevitel |
| Stripe | stripe.com | Egyszeri kreditcsomag-fizetés | Checkout Sessions | tranzakciófüggő | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | fizetéshez igen | – | user/plan metadata, összeg |

Javasolt első feltöltés: **fal.ai $25** (fedezi a teljes live smoke-ot + tréning-/generálási méréseket).
A Replicate-token opcionális, csak fallback-méréshez kell. Jóváhagyás után: `LIVE=1 npx vitest run tests/live`.
