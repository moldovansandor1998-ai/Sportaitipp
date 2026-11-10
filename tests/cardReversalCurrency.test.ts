import { describe, expect, it, vi } from 'vitest';
import { WhopProvider } from '@/server/billing/whop';
import type { WhopPlan } from '@/lib/billing/whop';
const plan: WhopPlan = { key: 'starter', accountId: 'biz_test', productId: 'prod_test', planId: 'plan_test', currency: 'usd', monthlyBasePrice: '29.00', monthlyCredits: 2000 };
const payment = { id: 'pay_test', account_id: 'biz_test', product_id: 'prod_test', variant_id: 'plan_test', membership_id: 'mem_test', user: { id: 'user_test' },
  status: 'paid', substatus: 'refunded', currency: 'eur', refunded_amount: { amount: '25.00', currency: 'eur' }, paid_at: '2026-11-01T12:00:00Z' };
function provider(raw = payment, kind: 'refund' | 'dispute' | null = null) {
  const fetcher = vi.fn();
  if (kind) fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ id: kind === 'refund' ? 'rf_test' : 'dspt_test', account_id: 'biz_test',
    ...(kind === 'refund' ? { payment_id: 'pay_test' } : { payment: { id: 'pay_test' } }) })));
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify(raw)));
  return new WhopProvider('fixture-only', true, fetcher);
}
describe('authoritative refund/reconciliation settlement currency', () => {
  it('reviews a EUR-settled payment for an approved USD-priced plan', async () => {
    await expect(provider().reviewPayment('pay_test', [plan])).resolves.toMatchObject({ paymentId: 'pay_test', revoke: true });
  });
  it.each(['refund', 'dispute'] as const)('verifies %s with refunded money in the payment settlement currency', async kind => {
    await expect(provider(payment, kind).verifyReversal(kind, kind === 'refund' ? 'rf_test' : 'dspt_test', [plan]))
      .resolves.toMatchObject({ paymentId: 'pay_test', membershipId: 'mem_test', revoke: true });
  });
  it('rejects internally inconsistent money currency in both readers', async () => {
    const inconsistent = { ...payment, refunded_amount: { amount: '25.00', currency: 'usd' } };
    await expect(provider(inconsistent).reviewPayment('pay_test', [plan])).rejects.toThrow();
    await expect(provider(inconsistent, 'refund').verifyReversal('refund', 'rf_test', [plan])).rejects.toThrow();
  });
  it.each([{ account_id: 'biz_other' }, { product_id: 'prod_other' }, { variant_id: 'plan_other' }, { id: 'pay_other' }])('preserves authoritative account/product/variant/payment scope checks', async change => {
    const other = { ...payment, ...change };
    await expect(provider(other).reviewPayment('pay_test', [plan])).rejects.toThrow();
    await expect(provider(other, 'refund').verifyReversal('refund', 'rf_test', [plan])).rejects.toThrow();
  });
});
