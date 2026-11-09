import 'server-only';
import { z } from 'zod';
import { WHOP_API_VERSION_DATE } from '@/lib/billing/whop';

export const WHOP_FEE_ACCOUNT = 'biz_6U5tOF8TtHSthq';
export const WHOP_FEE_URL = `https://api.whop.com/api/v1/accounts/${WHOP_FEE_ACCOUNT}/fees`;
// Official @whop/sdk 2.7.0 AccountFees contract. Editable limits are deliberately
// omitted: a maximum the caller may SET is not an actual fee or a fee ceiling.
const money = z.object({ amount: z.string().regex(/^\d{1,16}(\.\d{1,12})?$/), currency: z.string().regex(/^[a-z]{3}$/),
  decimals: z.number().int().min(0).max(12), display_decimals: z.number().int().min(0).max(12) });
const percentage = z.number().finite().min(0).nullable();
const source = z.enum(['default', 'custom', 'inherited']).nullable();
const rate = z.object({ percentage, fixed: money.nullable() });
const key = z.string().regex(/^[a-z0-9_]{1,64}$/);
const regional = rate.extend({ source, default: rate, reset: rate });
const fee = rate.extend({ category: z.enum(['payments', 'disputes', 'optimization', 'payouts', 'other']),
  ends_at: z.string().datetime().nullable(), source, region: key.nullable(),
  regions: z.record(key, regional), default: rate, reset: rate });
const markup = z.object({ percentage: z.number().finite().min(0), fixed: money,
  source: z.enum(['default', 'custom']).nullable(), default: rate });
const feeNames = ['ach_dispute', 'ach_return', 'bank_deposit', 'billing', 'buyer', 'card_processing', 'cross_border',
  'dispute', 'dispute_alert', 'dispute_alert_cdrn', 'dispute_alert_ethoca', 'dispute_alert_rdr', 'dispute_representment',
  'foreign_exchange', 'fraud_screening', 'high_risk', 'marketplace', 'orchestration', 'pending_auto_topup',
  'platform_processing', 'pool_payout', 'revshare', 'sepa_dispute', 'sepa_return', 'tax_calculation', 'tax_service', 'three_ds', 'transfers'] as const;
const fields = Object.fromEntries(feeNames.map(name => [name, fee]));
const scheduleSchema = z.object({ account_id: z.literal(WHOP_FEE_ACCOUNT), ...fields,
  parent_account_id: z.string().regex(/^biz_[A-Za-z0-9]+$/).nullable(),
  markups: z.object({ payments: markup, payouts: z.record(key, markup) }).nullable(),
  payment_methods: z.record(key, fee), payouts: z.record(key, fee) });

export function sanitizeWhopAccountFees(raw: unknown, retrievedAt: string) {
  const value = scheduleSchema.parse(raw);
  // z.object strips all undeclared provider fields, including unknown metadata.
  const { parent_account_id, ...schedule } = value;
  return { source: WHOP_FEE_URL, apiVersionDate: WHOP_API_VERSION_DATE, retrievedAt,
    accountHasParent: parent_account_id !== null, percentageUnit: 'percent' as const,
    settlementCurrency: null, settlementCurrencyStatus: 'not_provided_by_account_fees' as const,
    currentRatesArePermanentCeilings: false, schedule };
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body || Number(response.headers.get('content-length')) > 1_000_000) throw new Error('Fee response invalid');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 1_000_000) { await reader.cancel(); throw new Error('Fee response too large'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}

export async function readWhopAccountFees(env: Record<string, string | undefined> = process.env, fetcher = fetch) {
  if (env.VERCEL_ENV !== 'production' || env.WHOP_ENVIRONMENT === 'sandbox' || !env.WHOP_API_KEY)
    return { status: 503, body: { code: 'WHOP_FEE_READ_NOT_CONFIGURED' } };
  try {
    const response = await fetcher(WHOP_FEE_URL, { method: 'GET', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(8000), headers: { Authorization: `Bearer ${env.WHOP_API_KEY}`,
        Accept: 'application/json', 'Api-Version-Date': WHOP_API_VERSION_DATE } });
    if (response.status === 403) return { status: 403, body: { code: 'WHOP_FEE_READ_FORBIDDEN', access: 'denied', scopeExpansionAttempted: false } };
    if (response.status === 401) return { status: 502, body: { code: 'WHOP_FEE_READ_UNAUTHORIZED', access: 'not_verified', scopeExpansionAttempted: false } };
    if (!response.ok) return { status: 502, body: { code: 'WHOP_FEE_READ_UNAVAILABLE' } };
    return { status: 200, body: { code: 'WHOP_FEES_READ', ...sanitizeWhopAccountFees(await boundedJson(response), new Date().toISOString()) } };
  } catch {
    // Never return, log or interpolate a credential, upstream body or exception.
    return { status: 502, body: { code: 'WHOP_FEE_READ_UNAVAILABLE' } };
  }
}
