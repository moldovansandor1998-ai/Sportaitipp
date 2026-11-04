# Reddit publishing in Castora

This is a separate integration. Existing X accounts, post history, images and cron are unchanged.

## Implemented

- Per-character Reddit OAuth with encrypted tokens and single-use, browser-bound state.
- One selected community per character, 1–4 daily times in the selected timezone (Budapest by default), at least two hours apart.
- Native inline-image posts with a distinct image-grounded Hungarian caption, the character's existing `model_accounts` Fanvue URL, and clear AI-character/image disclosure. Only the same previously used, non-rejected public/TikTok gallery pool used by X is eligible. Private Fanvue image pools are excluded.
- Daily community discovery on connected accounts, including paused accounts. Searches are bounded and current community rules are checked. A discovery result never silently enables publishing. The owner chooses a destination and confirms that it permits AI models and Fanvue links. Advice/support and real-person matchmaking communities are excluded from model publishing.
- Rules are checked again before posting. Changed rules, explicit prohibitions, auth/rate-limit failures, or uncertain submission outcomes pause publishing.
- Per-owner publishing leases, per-slot claims, exact/perceptual image deduplication and caption similarity checks. History survives disconnection. An uncertain write is never automatically repeated.

## Prerequisites and activation

1. Apply `20261104001807_reddit_automation.sql` using the normal migration workflow. It adds service-role-only tables with RLS; no existing X data changes.
2. Obtain Reddit's approval for this specific app/use case. API access requires approval. Where Reddit treats the use as commercial, written commercial approval is also required. Do not treat possession of a client ID as approval.
3. Configure server-only variables through the deployment's secure environment controls:
   - `REDDIT_CLIENT_ID`
   - `REDDIT_CLIENT_SECRET`
   - `REDDIT_TOKEN_ENCRYPTION_KEY` (independent secret, at least 32 characters)
   - `REDDIT_REDIRECT_URI` (exact HTTPS `/api/reddit/callback` URL, matching the browser origin and registered Reddit callback)
   - `REDDIT_USER_AGENT` (truthful app/version/contact identity)
   - `REDDIT_API_APPROVED=true` only after approval is established
   - Existing `CRON_SECRET` and content-generation provider configuration remain required.
   - Optional `REDDIT_DISCOVERY_QUERIES`: up to four `|`-separated searches. Default: AI models, Fanvue, AI model photography.
4. On the character page, connect the intended Reddit account, inspect discovery results/current rules, set a permitted community and times, then explicitly enable. A connection or deployment alone never enables posting.

Do not put passwords, refresh tokens or client secrets into chat, source control, or browser-visible environment variables. OAuth grants and credential configuration require the account owner's authorization.

## Scheduled jobs

- `/api/reddit/process` every five minutes, protected by `CRON_SECRET`. Up to three due accounts per invocation. No missed-slot backfill or bursts.
- `/api/reddit/discovery-process` twice per hour, protected by `CRON_SECRET`. At most one due account per invocation; each account has a 24-hour discovery cooldown.
- Existing `/api/jobs/process` remains unchanged.

## Failure handling and limits

The native inline-media upload path is corroborated by the current PRAW implementation and its recorded integration fixtures, but its asset-upload endpoint is not fully documented by Reddit. Live approval/account testing is still necessary. An unavailable format/community fails visibly rather than falling back to an undisclosed external image URL.

`uncertain` or stale `sending` rows require checking the Reddit account before reconciliation. Do not delete the history or re-enable blindly. A `preparing` crash consumes that slot but cannot have submitted a post; the next scheduled slot may proceed. Prepared image reservations are retained conservatively. The similarity filter reduces reuse but cannot prove all images/text are semantically distinct.

Disconnect removes the locally stored tokens. It does not revoke the app grant at Reddit; the account owner can revoke it in Reddit's authorized-app settings.

Rule discovery is heuristic and cannot interpret every moderation requirement. Eligibility is not moderator permission, and a user confirmation is not a waiver of platform/community rules. The implementation does not automatically rotate into unreviewed communities, create accounts, send DMs, vote, evade bans, or republish removals.

## Sources checked 2026-11-04

- https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy
- https://support.reddithelp.com/hc/en-us/articles/360043504051-Spam
- https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki
- https://www.reddit.com/dev/api#POST_api_submit
- https://github.com/praw-dev/praw/blob/main/tests/integration/cassettes/TestSubreddit.test_submit__selftext_inline_media.json

## Verification

Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` on Node 22.
The Reddit test files mock every network/provider operation and require no secrets.
For the new SQL migration in isolated real PostgreSQL, install `pgserver` in a test environment and run `python tests/db/run_reddit_migration.py`. If local sockets are unavailable, `--single-user` validates the migration, grants and constraints without sockets; this mode explicitly skips the live two-connection concurrency proof. The repository's full Supabase integration suite is separate.
