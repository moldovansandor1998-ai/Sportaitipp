import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mock = vi.hoisted(() => ({ auth: vi.fn(), from: vi.fn(), select: vi.fn(), order: vi.fn(), limit: vi.fn() }));
vi.mock('@/lib/apiAuth', () => ({ authed: mock.auth }));
vi.mock('@/lib/security/internalAccess', () => ({ isInternalOwner: (email: string) => email === 'owner@example.invalid' }));
vi.mock('@/lib/supabase/server', () => ({ serviceClient: () => ({ from: mock.from }) }));
import { GET } from '@/app/api/admin/billing/whop-reviews/route';
const request = () => new NextRequest('https://example.test/api/admin/billing/whop-reviews');
beforeEach(() => {
  vi.clearAllMocks();
  mock.auth.mockResolvedValue({ email: 'owner@example.invalid', email_confirmed_at: 'verified', is_anonymous: false });
  mock.from.mockReturnValue({ select: mock.select }); mock.select.mockReturnValue({ order: mock.order }); mock.order.mockReturnValue({ limit: mock.limit });
  mock.limit.mockResolvedValue({ data: [{ payment_id: 'pay_fixture', membership_id: 'mem_fixture', reason: 'discounted_receipt' }], error: null });
});
it.each([null, { email: 'owner@example.invalid', is_anonymous: true, email_confirmed_at: 'verified' }, { email: 'owner@example.invalid', email_confirmed_at: null }])('denies missing, banned-filtered, anonymous or unconfirmed identities', async user => {
  mock.auth.mockResolvedValue(user);
  expect((await GET(request())).status).toBe(401); expect(mock.from).not.toHaveBeenCalled();
});
it('denies other users/admins before reading any review', async () => {
  mock.auth.mockResolvedValue({ email: 'admin@example.invalid', email_confirmed_at: 'verified', role: 'admin' });
  expect((await GET(request())).status).toBe(403); expect(mock.from).not.toHaveBeenCalled();
});
it('returns only explicit non-secret review fields with no-store', async () => {
  const response = await GET(request());
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
  expect(mock.select).toHaveBeenCalledWith('payment_id,membership_id,plan_id,reason,created_at,paid_base,currency');
  expect(await response.json()).toMatchObject({ reviews: [{ payment_id: 'pay_fixture' }] });
});
it('never presents a failed review read as an empty successful result', async () => {
  mock.limit.mockResolvedValue({ error: new Error('private fixture failure'), data: null });
  const response = await GET(request()); expect(response.status).toBe(503); expect(await response.text()).not.toContain('private fixture failure');
});
