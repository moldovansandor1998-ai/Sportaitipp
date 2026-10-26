# Castora USDT credit purchases — 2026-10-26

## Commercial configuration

One-time top-ups, no subscription/recurring debit:

| Plan | Credits | USDT |
|---|---:|---:|
| Starter | 1,000 | 15 |
| Pro | 5,000 | 65 |
| Studio | 15,000 | 180 |

The checkout applies a unique discount of 0.000001–0.099999 USDT. The displayed six-decimal amount must arrive exactly, excluding the sender's withdrawal/network fee. Invoice amounts are never reused. The bounded non-cycling sequence supports 99,999 orders; exhaustion fails closed and requires a reviewed allocation-range migration. Active pending orders are reused on repeated clicks; a user can create at most three orders in 24 hours. Orders expire after 24 hours; a transfer made within that window can be verified later.

Receiver: `THMbEe1gpmyM96gY4VpNT6fHSf1HfbGwdY`.
Mainnet USDT contract: `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`.
No wallet private key, seed phrase or spending permission is used.

## Flow

`/plans` → authenticated order → exact USDT/TRC20 transfer → user pastes TXID → mainnet SolidityNode receipt validation → atomic credit ledger update. Pending confirmations are checked every 16 seconds while the view remains open. Saved orders/TXIDs can be reopened after leaving the page. This is not an unattended wallet scanner: users must supply the TXID and resume checking if they close the page before confirmation.

`TRONGRID_API_KEY` is optional. Without it the public TronGrid endpoint is used; rate limits/outages fail closed and never grant credits. Customers are told not to pay again when verification is unavailable. Underpayments, overpayments, wrong tokens/networks, wrong recipients, late transfers and reused transactions cannot be auto-credited; support review is necessary. No automatic refunds or outgoing transfers are implemented.

The database stores immutable credit/amount/recipient snapshots. Clients have own-row SELECT only, no write grants or access to either settlement RPC. Both RPCs are SECURITY INVOKER and granted only to service_role. A unique transaction hash plus unique ledger key and row locking make settlement atomic and replay-safe.

## Pricing basis and limitations

Pricing is based on configured adapters and publicly posted provider tariffs checked on 2026-10-26. It is not a reconciliation of provider invoices or a guarantee of net profit. Illustrative Studio-rate proceeds, before the tiny invoice discount:

| Operation | Provider cost USD | Credits | Revenue USDT | Contribution before other costs |
|---|---:|---:|---:|---:|
| Seedream 4.5 edit, one image | 0.04 | 40 | 0.48 | 0.44 |
| Nureta Seahorse 480p, 5s, no extra voice | 0.944 | 312 | 3.744 | 2.800 |
| Nureta Seahorse 720p, 5s, no extra voice | 1.3865 | 458 | 5.496 | 4.1095 |
| fal sync-3 lip sync, 60 measured seconds | 8.00 | 2640 | 31.68 | 23.68 |

Sources:
- https://wavespeed.ai/models/bytedance/seedream-v4.5/edit
- https://developer.nureta.ai/docs/video
- https://fal.ai/models/fal-ai/sync-lipsync/v3
- https://wavespeed.ai/docs/docs-api/sync/sync-lipsync-2-pro
- https://tether.to/en/supported-protocols/
- https://developers.tron.network/reference/gettransactioninfobyid-1

FAL image quantities, video durations, training steps and speech length now scale their credit charge. Generic FAL lip sync measures both media inputs on the server and prices the longer duration; caller-supplied duration cannot lower the charge. Existing Nureta/WaveSpeed estimates and voice supplements are preserved. Raw image/training/video parameters are bounded before credit reservation.

Hosting, storage, support, taxes, free signup credits, bundled helper calls, possible provider charges on failed/retried tasks, provider price changes and token exchange/depeg risk are not included in the illustrative contribution. Exact net profit requires provider invoice/usage reconciliation. The existing 200-credit signup bonus remains unchanged. Stripe code and existing HUF plans are preserved; the purchase page now offers USDT.

## Account isolation and verification

Production RLS is enabled on characters, character references/voices and credit accounts. User-scoped queries use owner_id. Generation preparation rejects characters belonging to another account. Administrators have intentional wider read access; normal registered users do not inherit the owner's characters.

Legacy name-based ElevenLabs environment mappings are restricted to the original owner account. A new user's namesake character does not inherit those voices; their own model voice must be configured separately. Existing explicit voice assignments continue working.

Validation:
- TypeScript typecheck and full unit/integration suite.
- `tests/cryptoPayments.test.ts`: authentic token, receipt identity, success/finality, recipient, exact integer amount, order time window, provider outage and quantity pricing.
- `tests/db/crypto_credits.sql`: rollback-only production database integration test. Checks account ownership, idempotent order creation, exact amount, one-time ledger posting, cross-order transaction replay rejection, RLS and RPC privileges. Does not transfer funds or retain test balance changes.
- Public TronGrid endpoint reachable and returned an empty receipt for an unknown transaction.

No real on-chain purchase has been sent by the agent.
