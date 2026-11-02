# New speech on an existing model video

AI tools → select a character → **Új szöveg a kész videóra · hang és szájszinkron**.

1. Upload an MP4 (up to 48 MB / 180 seconds) or select the character's generated gallery video.
2. Paste the complete script, up to 3,000 characters. Choose conversational, cheerful TikTok or energetic delivery.
3. Request the speech price, generate and listen to the selected character's saved Hungarian voice.
4. Request the lipsync price. The server measures the actual completed speech and source video, then shows their lengths and the exact credit quote.
5. Start the separately priced lipsync job. Its MP4 is saved through the existing jobs/gallery pipeline.

The video uses Sync Lipsync 2 Pro with `sync_mode: loop`. Short source footage repeats until the FULL approved audio ends; longer footage is trimmed to that audio. The original footage supplies the person, setting, clothing, framing and motion. This is mouth-motion postprocessing, not a new scene/image generator or an audio-only replacement. Existing source zoom/motion is retained; this feature does not add zoom. Generated facial details and synchronization still require visual review.

Both steps use the existing atomic credit hold, submission guard, idempotency key, polling and refund flow. Speech is charged independently even if the user stops after the preview. Estimates do not submit generation. Lipsync billing is based on measured speech seconds at $0.084/second × the existing 330-credit conversion; speech uses a text-length estimate. Speech beyond 180 seconds is rejected rather than silently cut. The completed video must contain video and audio streams and match the full speech duration within a small container/encoding tolerance.

Only server-resolved, owner-scoped assets, completed same-character speech jobs and the current stored character voice are accepted. Client URLs, voice IDs, timing and synchronization modes cannot override these values. Generated source videos must also belong to that character's non-deleted gallery. Re-resolve inputs when the background worker starts so expired signed URLs are refreshed. No schema migration or new credentials are required: the configured ElevenLabs and WaveSpeed keys are reused.

The `video_redub` adapter is explicitly selected only for `tts + videoRedubSpeech` and `lip_sync + videoRedub`. Ordinary TTS, ordinary lipsync, motion generation and Nureta postprocessing keep their existing provider routes.

Provider references:
- https://wavespeed.ai/docs/docs-api/sync/sync-lipsync-2-pro
- https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/how-do-audio-tags-work-with-eleven-v3-and-v4

Verification: `tests/videoRedub.test.ts`, `tests/nuretaLipSync.test.ts`, `tests/mediaDuration.test.ts`, full unit suite, TypeScript and production build. A paid provider run is separate from mocked request-contract tests; do not claim real output quality was verified from these tests alone.
