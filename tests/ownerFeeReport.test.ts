import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ browserClient: () => ({ auth: { getSession: mocks.getSession } }) }));
import { loadOwnerFeeReport } from '@/lib/billing/owner-fee-report';
const token = 'synthetic-session-not-a-real-token';
const body = { code: 'WHOP_FEES_READ', source: 'https://api.whop.com/api/v1/accounts/biz_fixture/fees',
  retrievedAt: '2026-11-09T00:00:00Z', apiVersionDate: '2026-08-24', percentageUnit: 'percent',
  currentRatesArePermanentCeilings: false, settlementCurrency: null,
  settlementCurrencyStatus: 'not_provided_by_account_fees', accountHasParent: false,
  schedule: { card_processing: { percentage: 2.7 } } };
beforeEach(() => { vi.clearAllMocks(); mocks.getSession.mockResolvedValue({ data: { session: { access_token: token } }, error: null }); });
afterEach(() => { vi.unstubAllGlobals(); });
describe('existing owner session fee report', () => {
  it('uses the session only for the fixed same-origin GET and copies only report fields', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ...body, access_token: token, unknown: 'private' })));
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController(); const result = await loadOwnerFeeReport(controller.signal);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/admin/billing/whop-fees', {
      method: 'GET', cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: controller.signal,
      headers: { authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) { const { code, ...expected } = body; expect(code).toBe('WHOP_FEES_READ'); expect(JSON.parse(result.text)).toEqual(expected); expect(result.text).not.toContain(token); expect(result.text).not.toContain('private'); }
  });
  it.each([null, { access_token: '' }])('does not request fees without an existing session', async session => {
    mocks.getSession.mockResolvedValue({ data: { session }, error: null });
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect(await loadOwnerFeeReport()).toEqual({ ok: false, code: 'AUTH_REQUIRED' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('stops on session errors instead of using a stale token', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: token } }, error: new Error(token) });
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect(await loadOwnerFeeReport()).toEqual({ ok: false, code: 'AUTH_REQUIRED' }); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['OWNER_REQUIRED', 'WHOP_FEE_READ_FORBIDDEN', 'WHOP_FEE_READ_UNAUTHORIZED'])('shows only a safe error code and never retries %s', async code => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ code, upstream: token }), { status: 403 }));
    vi.stubGlobal('fetch', fetcher); expect(await loadOwnerFeeReport()).toEqual({ ok: false, code }); expect(fetcher).toHaveBeenCalledOnce();
  });
  it('does not display arbitrary error text, malformed success or thrown errors', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ code: token, error: token }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'WHOP_FEES_READ', access_token: token })))
      .mockRejectedValueOnce(new Error(token));
    vi.stubGlobal('fetch', fetcher);
    for (let i = 0; i < 3; i++) expect(await loadOwnerFeeReport()).toEqual({ ok: false, code: 'FEE_READ_UNAVAILABLE' });
  });
  it('keeps PDF output report-only and the page behind existing admin middleware', () => {
    const page = readFileSync('src/app/(app)/admin/billing/page.tsx', 'utf8');
    expect(page).toContain('downloadOwnerFeePdf(report)');
    expect(page).not.toContain('navigator.clipboard');
    expect(page).toContain('PDF-ben');
    expect(page).not.toMatch(/localStorage|document\.cookie|access_token|signInWith|dangerouslySetInnerHTML/);
    expect(page).toContain('if (pending.current || denied) return');
    expect(page).toContain('disabled={busy || denied}');
    expect(page).toContain('pending.current?.abort()');
    const middleware = readFileSync('src/lib/supabase/middleware.ts', 'utf8');
    expect(middleware).toContain('"/admin"'); expect(middleware).toContain('isInternalPath(path) && !isInternalOwner(');
  });
  it('shows only bounded safe diagnostic fields and no arbitrary raw error properties', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'WHOP_FEE_SCHEMA_MISMATCH',
      diagnostic: { stage: 'schema', upstreamStatus: 200, issueCount: 2,
        issues: [{ path: 'card_processing.percentage', code: 'invalid_type', message: token, input: token }],
        body: token, headers: { authorization: token }, message: token } }), { status: 502 })));
    const result = await loadOwnerFeeReport();
    expect(result).toEqual({ ok: false, code: 'WHOP_FEE_SCHEMA_MISMATCH', detail: JSON.stringify({ stage: 'schema',
      upstreamStatus: 200, issueCount: 2, issues: [{ path: 'card_processing.percentage', code: 'invalid_type' }] }) });
    expect(JSON.stringify(result)).not.toContain(token);
  });
  it('keeps numeric upstream failures visible rather than collapsing them to unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'WHOP_FEE_HTTP_ERROR',
      diagnostic: { stage: 'http', upstreamStatus: 404, body: token } }), { status: 502 })));
    expect(await loadOwnerFeeReport()).toEqual({ ok: false, code: 'WHOP_FEE_HTTP_ERROR', detail: '{"stage":"http","upstreamStatus":404}' });
  });

});
