import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { readWhopAccountFees, sanitizeWhopAccountFees, WHOP_FEE_ACCOUNT, WHOP_FEE_URL } from '@/server/billing/whop-account-fees';
const auth = vi.hoisted(() => ({ authed: vi.fn() }));
vi.mock('@/lib/apiAuth', () => ({ authed: auth.authed }));
// Public handler fixture uses a synthetic identity. The real production owner
// predicate is unchanged and independently covered by contact-privacy tests.
vi.mock('@/lib/security/internalAccess', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/internalAccess')>();
  return { ...actual, isInternalOwner: (email: string | null | undefined) =>
    email?.trim().toLowerCase() === 'owner-fees@example.invalid' };
});
import { GET } from '@/app/api/admin/billing/whop-fees/route';
const fixtureKey = 'fixture_never_a_real_key';
const env = { VERCEL_ENV: 'production', WHOP_API_KEY: fixtureKey };
const fixed = { amount: '0.30', currency: 'usd', decimals: 2, display_decimals: 2 };
const rate = { percentage: 2.7, fixed };
const fee = { ...rate, category: 'payments', source: 'custom', region: null, regions: {}, ends_at: '2027-01-01T00:00:00Z', default: rate, reset: rate };
const names = ['ach_dispute', 'ach_return', 'bank_deposit', 'billing', 'buyer', 'card_processing', 'cross_border', 'dispute', 'dispute_alert', 'dispute_alert_cdrn', 'dispute_alert_ethoca', 'dispute_alert_rdr', 'dispute_representment', 'foreign_exchange', 'fraud_screening', 'high_risk', 'marketplace', 'orchestration', 'pending_auto_topup', 'platform_processing', 'pool_payout', 'revshare', 'sepa_dispute', 'sepa_return', 'tax_calculation', 'tax_service', 'three_ds', 'transfers'];
function rawSchedule() { return { account_id: WHOP_FEE_ACCOUNT, parent_account_id: null, markups: null, payment_methods: {}, payouts: {}, ...Object.fromEntries(names.map(n => [n, fee])) }; }
function request(query = '') { return new NextRequest(`https://example.test/api/admin/billing/whop-fees${query}`, { headers: { Authorization: 'Bearer fixture-session' } }); }
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('WHOP_API_KEY', fixtureKey); vi.stubEnv('WHOP_ENVIRONMENT', ''); auth.authed.mockResolvedValue({ id: 'verified-owner', email: 'owner-fees@example.invalid', email_confirmed_at: '2026-11-01T00:00:00Z', is_anonymous: false }); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('owner-only Whop fee read and secret isolation', () => {
  it.each([null, { email: 'owner-fees@example.invalid', is_anonymous: true, email_confirmed_at: 'verified' }, { email: 'owner-fees@example.invalid', is_anonymous: false, email_confirmed_at: null }])('denies absent, banned-filtered, anonymous or unconfirmed identity', async user => {
    auth.authed.mockResolvedValue(user); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const result = await GET(request()); expect(result.status).toBe(401); expect(fetcher).not.toHaveBeenCalled();
    expect(result.headers.get('cache-control')).toContain('no-store');
  });
  it('rejects another verified admin and arbitrary URL/account parameters before outbound access', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    auth.authed.mockResolvedValueOnce({ email: 'other@example.test', email_confirmed_at: 'verified', is_anonymous: false, role: 'admin' });
    expect((await GET(request())).status).toBe(403);
    expect((await GET(request('?url=https://other.test&account_id=biz_other'))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('reads only fixed production GET with private no-store and works with all checkout flags absent', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(rawSchedule()))); vi.stubGlobal('fetch', fetcher);
    const result = await GET(request()); expect(result.status).toBe(200);
    expect(fetcher.mock.calls[0]?.[0]).toBe(WHOP_FEE_URL);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', redirect: 'error', cache: 'no-store' });
    expect(await result.text()).not.toContain(fixtureKey);
    expect(result.headers.get('vary')).toBe('Authorization');
  });
  it('strips unknown provider secrets and editable maximums, preserves fee units/expiry/currency', () => {
    const result = sanitizeWhopAccountFees({ ...rawSchedule(), api_key: fixtureKey, child_markups: { secret: fixtureKey }, card_processing: { ...fee, maximum: { percentage: 99, secret: fixtureKey }, secret: fixtureKey } }, '2026-11-09T00:00:00Z');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(fixtureKey); expect(serialized).not.toContain('maximum');
    expect(serialized).toContain('2027-01-01T00:00:00Z'); expect(serialized).toContain('"currency":"usd"');
    expect(result.percentageUnit).toBe('percent'); expect(result.settlementCurrency).toBeNull();
    expect(() => sanitizeWhopAccountFees({ ...rawSchedule(), account_id: 'biz_other' }, '')).toThrow();
  });
  it('does not read keys for a preview/sandbox and never sends an unconfigured request', async () => {
    const fetcher = vi.fn();
    for (const configuration of [{}, { ...env, VERCEL_ENV: 'preview' }, { ...env, WHOP_ENVIRONMENT: 'sandbox' }]) expect((await readWhopAccountFees(configuration, fetcher)).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('redacts upstream 403 and throws without logging or retrying the key', async () => {
    const logs = [vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'log')];
    const denied = vi.fn(async () => new Response(fixtureKey, { status: 403 }));
    const result = await readWhopAccountFees(env, denied);
    expect(result.status).toBe(403); expect(result.body).toMatchObject({ access: 'denied', scopeExpansionAttempted: false });
    expect(JSON.stringify(result)).not.toContain(fixtureKey); expect(denied).toHaveBeenCalledOnce();
    const failed = await readWhopAccountFees(env, vi.fn(async () => { throw new Error(fixtureKey); }));
    expect(JSON.stringify(failed)).not.toContain(fixtureKey);
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });
});
