import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const fixtures = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; email_confirmed_at: string; user_metadata?: Record<string, unknown> },
  role: 'admin',
  getUser: vi.fn(), service: vi.fn(), rpc: vi.fn(), update: vi.fn(), insert: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: fixtures.getUser } }) }));
vi.mock('@/lib/supabase/server', () => ({ serviceClient: fixtures.service }));
import { POST as credit } from '@/app/api/admin/credits/route';
import { POST as users } from '@/app/api/admin/users/route';
import { GET as summary } from '@/app/api/admin/summary/route';
import { POST as reconcile } from '@/app/api/admin/jobs/reconcile/route';
const owner = { id: '11111111-1111-4111-8111-111111111111', email: 'moldovansandor1998@gmail.com', email_confirmed_at: '2026-01-01T00:00:00Z' };
const target = '22222222-2222-4222-8222-222222222222';
const cases = [
  { name: 'credits', handler: credit, method: 'POST', body: { userId: target, amount: 25, note: 'Authorized adjustment' } },
  { name: 'users', handler: users, method: 'POST', body: { userId: target, action: 'set_role', role: 'user' } },
  { name: 'summary', handler: summary, method: 'GET', body: undefined },
  { name: 'jobs/reconcile', handler: reconcile, method: 'POST', body: { lookupJobId: target, action: 'mark_failed', reason: 'Provider failure verified' } },
];
function request(entry: typeof cases[number]) {
  return new NextRequest(`http://localhost/api/admin/${entry.name}`, { method: entry.method, headers: { authorization: 'Bearer signed-fixture-token', 'content-type': 'application/json' }, ...(entry.body ? { body: JSON.stringify(entry.body) } : {}) });
}
beforeEach(() => {
  vi.clearAllMocks(); fixtures.user = { ...owner }; fixtures.role = 'admin';
  fixtures.getUser.mockImplementation(async () => ({ data: { user: fixtures.user }, error: null }));
  fixtures.rpc.mockResolvedValue({ data: true, error: null });
  fixtures.service.mockImplementation(() => ({
    rpc: fixtures.rpc,
    from: (table: string) => {
      const query = {
        select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), gte: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
        single: vi.fn(async () => ({ data: { role: fixtures.role }, error: null })),
        maybeSingle: vi.fn(async () => ({ data: { id: target, status: 'submission_uncertain' }, error: null })),
        update: (...args: unknown[]) => { fixtures.update(table, ...args); return query; },
        insert: (...args: unknown[]) => { fixtures.insert(table, ...args); return query; },
        then: <TResult1 = { data: never[]; error: null }, TResult2 = never>(resolve?: ((value: { data: never[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null, reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) => Promise.resolve({ data: [] as never[], error: null }).then(resolve, reject),
      };
      return query;
    },
  }));
});
describe.each(cases)('owner-only admin $name', entry => {
  it('rejects another authenticated admin before service reads or mutations', async () => {
    fixtures.user = { ...owner, email: 'another-admin@example.test', user_metadata: { email: owner.email, email_verified: true, role: 'admin' } };
    expect((await entry.handler(request(entry))).status).toBe(403);
    expect(fixtures.getUser).toHaveBeenCalledWith('signed-fixture-token');
    expect(fixtures.service).not.toHaveBeenCalled();
    expect(fixtures.rpc).not.toHaveBeenCalled(); expect(fixtures.update).not.toHaveBeenCalled(); expect(fixtures.insert).not.toHaveBeenCalled();
  });
  it('keeps unauthenticated callers at 401', async () => {
    fixtures.user = null;
    expect((await entry.handler(request(entry))).status).toBe(401);
    expect(fixtures.service).not.toHaveBeenCalled();
  });
  it('retains the separate admin role requirement for the owner', async () => {
    fixtures.role = 'user';
    expect((await entry.handler(request(entry))).status).toBe(403);
    expect(fixtures.rpc).not.toHaveBeenCalled(); expect(fixtures.update).not.toHaveBeenCalled(); expect(fixtures.insert).not.toHaveBeenCalled();
  });
  it('preserves the existing verified owner operation', async () => {
    const response = await entry.handler(request(entry));
    expect(response.status).toBe(200);
    if (entry.name === 'credits') expect(fixtures.rpc).toHaveBeenCalledWith('credit_admin_adjust', expect.objectContaining({ p_user: target, p_amount: 25, p_admin: owner.id }));
    if (entry.name === 'users') { expect(fixtures.update).toHaveBeenCalledWith('profiles', { role: 'user' }); expect(fixtures.insert).toHaveBeenCalledWith('audit_logs', expect.objectContaining({ actor_id: owner.id, target_id: target })); }
    if (entry.name === 'jobs/reconcile') expect(fixtures.rpc).toHaveBeenCalledWith('admin_mark_failed', expect.objectContaining({ p_job: target, p_admin: owner.id }));
  });
});
