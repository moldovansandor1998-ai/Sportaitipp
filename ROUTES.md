# Route/API lista

## UI (App Router)
- `/login`, `/register`, `/auth/reset`, `/auth/callback` – auth (Supabase; callback createServerClient-del)
- `/dashboard` – kezdőpult · `/characters`, `/characters/new`, `/characters/[id]` – karakterfolyamat (mock/éles)
- `/gallery` – galéria (signed URL, soft-delete) · `/jobs` – élő állapot + események · `/settings` – értesítések
- `/calendar`, `/plans` – váz (6. mérföldkő) · `/terms`, `/privacy` – statikus jogi minta

## API
- `POST/GET /api/jobs` – job létrehozás (Zod + prekondíciók + atomi hold egy RPC-ben) / listázás
- `GET /api/gallery` – saját elemek, signed URL-ek (deleted_at IS NULL)
- `DELETE /api/gallery/[id]` – soft-delete + retryzható purgálás
- `GET /api/assets/[id]/url` – signed URL tulajdon-ellenőrzés után
- `POST /api/uploads/sign` – aláírt feltöltés a privát references bucketbe
- `POST /api/references/finalize` – szerveroldali ellenőrzés (méret/MIME/tulajdon/SHA-256/duplikátum)
- `POST /api/webhooks/provider/[name]` – provider webhook (valódi sémák, verify→replay→idempotens feldolgozás)
- `POST /api/webhooks/resend` – svix bounce/complaint/suppressed
- `POST /api/jobs/process` – cron: reaper + claim + resume (fail-closed, Bearer CRON_SECRET)
- `POST /api/purge` – cron: soft-delete-elt elemek takarítása
- `POST /api/admin/credits` – admin kreditmódosítás (JWT+role+auditált RPC)
