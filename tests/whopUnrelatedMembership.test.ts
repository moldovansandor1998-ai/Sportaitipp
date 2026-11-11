import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { WHOP_API_VERSION_DATE, type WhopPlan } from '@/lib/billing/whop';
import type { WhopEvent } from '@/server/billing/whop-webhook';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ serviceClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock('@/server/billing/whop-config', () => ({ whopConfig: () => ({ token: 'test', secret: 'fixture_secret', sandbox: true,
  plans: [{ accountId: 'biz_6U5tOF8TtHSthq', productId: 'prod_startai', planId: 'plan_startai' }] }) }));
vi.mock('@/server/billing/whop', () => ({ WhopProvider: class { readMembership = mocks.read; } }));
import { POST } from '@/app/api/webhooks/whop/route';
import { completeUnrelatedMembershipEvent, processCardEvent } from '@/server/billing/whop-card';
const plan: WhopPlan = { key: 'starter', accountId: 'biz_6U5tOF8TtHSthq', productId: 'prod_startai', planId: 'plan_startai', currency: 'usd', monthlyBasePrice: '29.00', monthlyCredits: 2000 };
const event: WhopEvent = { id: 'msg_test', type: 'membership.updated', account_id: plan.accountId, api_version: 'v1', api_version_date: WHOP_API_VERSION_DATE, timestamp: '2026-11-09T21:23:10.720Z', data: { id: 'mem_test' } };
const membership = { id: 'mem_test', account: { id: plan.accountId }, product_id: 'prod_kJNCcExSOz0T5', variant_id: 'plan_f572ZToSkG2Ft', metadata: { project_key: 'vagyokrad' }, user_id: 'user_test', status: 'active', updated_at: event.timestamp };
const provider = { readMembership: mocks.read, verifyPayment: vi.fn(), verifyReversal: vi.fn() };
function request(tamper = false, eventChange = {}) {
  const raw = JSON.stringify({ ...event, ...eventChange }); const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', 'fixture_secret').update(`${event.id}.${timestamp}.${raw}`).digest('base64');
  return new NextRequest('https://example.test/api/webhooks/whop', { method: 'POST', body: raw + (tamper ? ' ' : ''),
    headers: { 'webhook-id': event.id, 'webhook-timestamp': String(timestamp), 'webhook-signature': `v1,${signature}` } });
}
function persistence(error: unknown = null, data: unknown = { event_id: event.id }) {
  const query = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ error, data }) };
  mocks.from.mockReturnValue(query); return query;
}
beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockResolvedValue({ data: 'pending', error: null }); mocks.read.mockResolvedValue(membership); persistence(); });
describe('isolated VagyokRad membership acknowledgement', () => {
  it.each(['membership.updated', 'membership.activated'])('acknowledges verified %s without any entitlement RPC', async type => {
    const rpc = vi.fn(); const complete = vi.fn().mockResolvedValue('ignored');
    expect(await processCardEvent({ ...event, type }, [plan], provider, rpc, complete)).toBe('ignored');
    expect(mocks.read).toHaveBeenCalledWith(event.data.id); expect(complete).toHaveBeenCalledOnce(); expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    { id: 'mem_other' }, { account: { id: 'biz_other' } }, { product_id: 'prod_other' }, { variant_id: 'plan_other' },
    { metadata: null }, { metadata: {} }, { metadata: { project_key: 'startai' } }, { updated_at: 'invalid' },
  ])('keeps incomplete or mismatched evidence retryable: %j', async change => {
    mocks.read.mockResolvedValue({ ...membership, ...change }); const complete = vi.fn();
    await expect(processCardEvent(event, [plan], provider, vi.fn(), complete)).rejects.toThrow(); expect(complete).not.toHaveBeenCalled();
  });
  it('does not ignore unknown products or partial StartAI identity matches', async () => {
    const complete = vi.fn();
    for (const changedPlan of [{ ...plan, productId: membership.product_id }, { ...plan, planId: membership.variant_id }]) {
      await expect(processCardEvent(event, [changedPlan], provider, vi.fn(), complete)).rejects.toThrow('Membership mismatch');
    }
    expect(complete).not.toHaveBeenCalled();
  });
  it('preserves StartAI active and canceled membership processing', async () => {
    for (const status of ['active', 'canceled']) {
      mocks.read.mockResolvedValue({ ...membership, product_id: plan.productId, variant_id: plan.planId, status });
      const rpc = vi.fn().mockResolvedValue('processed'); const complete = vi.fn();
      expect(await processCardEvent(event, [plan], provider, rpc, complete)).toBe('processed');
      expect(rpc).toHaveBeenCalledWith('whop_card_membership_event', expect.objectContaining({ p_plan: plan.planId, p_active: status === 'active' }));
      expect(complete).not.toHaveBeenCalled();
    }
  });
  it('rejects forged signed body before provider reads or persistence', async () => {
    expect((await POST(request(true))).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
  });
  it('rejects a signed wrong account before any persistence', async () => {
    expect((await POST(request(false, { account_id: 'biz_other' }))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });
  it('returns 200 ignored only after signature, receipt capture, provider verification and durable completion', async () => {
    const q = persistence(); const response = await POST(request());
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ code: 'ignored' });
    expect(mocks.rpc).toHaveBeenCalledOnce(); expect(mocks.rpc.mock.calls[0][0]).toBe('whop_card_receive');
    expect(mocks.from).toHaveBeenCalledWith('whop_card_events'); expect(q.update).toHaveBeenCalledWith({ status: 'processed', completed_at: expect.any(String) });
    for (const [key, value] of Object.entries({ event_id: event.id, event_type: event.type, account_id: event.account_id, resource_id: event.data.id })) expect(q.eq).toHaveBeenCalledWith(key, value);
    expect(q.in).toHaveBeenCalledWith('status', ['pending', 'processed']);
  });
  it('does not acknowledge persistence or provider failure', async () => {
    persistence({ message: 'offline' }); expect((await POST(request())).status).toBe(503);
    persistence(); mocks.read.mockRejectedValueOnce(new Error('unavailable')); expect((await POST(request())).status).toBe(503);
    mocks.rpc.mockResolvedValueOnce({ error: { message: 'offline' } }); persistence({ message: 'offline' }); expect((await POST(request())).status).toBe(503);
  });
  it('does not acknowledge a missing/mismatched/review receipt', async () => {
    persistence(null, null); await expect(completeUnrelatedMembershipEvent(event)).rejects.toThrow();
  });
  it('recovers a known unrelated retry with a refreshed timestamp after receipt mismatch', async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { message: 'EVENT_MISMATCH' } });
    const response = await POST(request(false, { timestamp: '2026-11-11T18:24:09.632Z' }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ code: 'ignored' });
    expect(mocks.read).toHaveBeenCalledOnce(); expect(mocks.from).toHaveBeenCalledWith('whop_card_events');
  });
  it('keeps retry recovery failures retryable without fabricating receipts', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'EVENT_MISMATCH' } });
    persistence(null, null); expect((await POST(request())).status).toBe(503);
    persistence(); mocks.read.mockRejectedValueOnce(new Error('provider unavailable'));
    expect((await POST(request())).status).toBe(503);
    persistence({ message: 'database unavailable' }); expect((await POST(request())).status).toBe(503);
  });
  it('keeps StartAI timestamp mismatches retryable without updating any receipt', async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { message: 'EVENT_MISMATCH' } });
    mocks.read.mockResolvedValue({ ...membership, product_id: plan.productId, variant_id: plan.planId });
    expect((await POST(request())).status).toBe(503); expect(mocks.from).not.toHaveBeenCalled();
  });
  it('keeps payment receipt failure retryable without membership lookups', async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { message: 'EVENT_MISMATCH' } });
    expect((await POST(request(false, { type: 'payment.succeeded' }))).status).toBe(503); expect(mocks.read).not.toHaveBeenCalled();
  });
  it('skips reprocessing an already completed receipt', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: 'processed', error: null });
    const response = await POST(request()); expect(await response.json()).toEqual({ code: 'duplicate' }); expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
  });
});
