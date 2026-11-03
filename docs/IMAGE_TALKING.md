# Képből beszélő videó

AI eszközök → válassz karaktert → **Képből beszélő videó · saját szöveg és modellhang**.

- Saját JPG/PNG/WebP kiindulókép feltöltése (4 MB-ig), vagy ugyanahhoz a karakterhez tartozó galériakép kiválasztása.
- Saját szöveg (legfeljebb 3000 karakter), valamint mesélős, kíváncsi, vidám, komoly, magabiztos, természetes vagy lelkes előadásmód.
- Visszafogott, természetes vagy élénkebb gesztusok; 480p / 720p videó.
- A hang előzetesen meghallgatható, elkészült beszéd ingyen visszatölthető. A hang és a videó külön, előre látható kredittel indul.
- A „Kommentindító minta” a magyarországi nettó megélhetésről és megtakarításról kérdez, VagyokRád/DORIKA kód ajánlással és a bióban lévő Telegramra hívással. A szöveg szabadon szerkeszthető, és nem posztolódik automatikusan.

The existing paid speech pipeline generates the selected character's full Hungarian audio. Image talking uses `talking_video + imageTalking: true`, isolated to the new `image_talking` adapter, posting the owned starting image, approved full audio and server-authored mood/motion prompt to `wavespeed-ai/infinitetalk`. The original video-redub, Nureta, ordinary TTS and lipsync routes retain their providers. Mood is taken from the completed speech job, so audio and facial delivery remain aligned. Changing text or delivery invalidates an old audio approval; changing motion or resolution invalidates the video quote.

The server checks asset ownership, generated-gallery character binding, soft deletion, the current saved voice, completed speech provenance, actual audio duration (max 180 seconds), image MIME and size. Client URLs, timing, prompts and voice IDs are discarded. Workers re-sign inputs on execution. The input image is resized with `fit: contain` to 720×1280 without cropping or regeneration, with neutral padding where needed. Prompt continuity enforces one person, the original face/hair/eyes/clothes, static camera and no zoom. Generation may still produce artifacts; review the real rendered face, gestures and synchronization before posting.

Pricing uses measured audio duration, with a 3-second minimum: $0.03/sec at 480p, $0.06/sec at 720p, multiplied by the existing 330-credit conversion. Submission is guarded by the existing job ledger and idempotency flow; no automatic retry/failover creates another billed generation. Output must have audio/video streams and match full-speech duration within encoding tolerance, then goes into the TikTok gallery as an MP4.

Provider contract: https://wavespeed.ai/docs/docs-api/wavespeed-ai/infinitetalk

Validation: imageTalking tests cover schema, routing isolation, ownership, same-voice completed audio, authoritative mood, full-duration pricing, no-zoom prompts, full-audio request shape, real Sharp 9:16 padding and rejection before a paid request for corrupt input. Mocked contracts do not verify a real generated person's motion quality.
