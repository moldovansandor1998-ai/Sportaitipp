import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { verifyWhopPayment, verifyWhopVariant, assertCardCheckoutMethods } from '@/server/billing/whop';
import { whopSalesEnabled } from '@/server/billing/whop-sales';
import { verifyWhopWebhook } from '@/server/billing/whop-webhook';
import { WHOP_API_VERSION_DATE, type WhopPlan } from '@/lib/billing/whop';
const mocks = vi.hoisted(() => ({ receive: vi.fn(), process: vi.fn() }));
vi.mock('@/server/billing/whop-card', () => ({ CARD_EVENTS: new Set(['payment.succeeded']), receiveCardEvent: mocks.receive, processCardEvent: mocks.process }));
vi.mock('@/server/billing/whop-config', () => ({ whopConfig: () => ({ token: 'test', secret: 'fixture_secret', sandbox: true, plans: [{ accountId: 'biz_test' }] }) }));
import { POST } from '@/app/api/webhooks/whop/route';

const plan: WhopPlan = { key: 'starter', accountId: 'biz_test', productId: 'prod_test', planId: 'plan_test', currency: 'usd', monthlyBasePrice: '29.00', monthlyCredits: 2000 };
const now = Date.parse('2026-11-09T12:00:00Z');
const money = (amount: string) => ({ amount, currency: 'usd' });
const membership = { id: 'mem_test', account: { id: 'biz_test' }, product_id: 'prod_test', variant_id: 'plan_test', user_id: 'user_test', status: 'active', billing_period_days: 30, current_period_start: '2026-11-01T12:00:00Z', current_period_end: '2026-12-01T12:00:00Z', updated_at: '2026-11-01T12:00:00Z' };
const payment = { id: 'pay_test', account_id: 'biz_test', product_id: 'prod_test', variant_id: 'plan_test', membership_id: 'mem_test', user: { id: 'user_test' }, status: 'paid', substatus: 'succeeded', billing_reason: 'subscription_create', paid_at: '2026-11-01T12:00:01Z', currency: 'usd', subtotal: money('29'), total: money('36.83'), tax_amount: money('7.83'), tax_behavior: 'exclusive', refunded_amount: money('0'), checkout_configuration_id: 'ch_test', metadata: { castora_binding: 'a'.repeat(64) } };
const variant = { id: 'plan_test', account: { id: 'biz_test' }, product: { id: 'prod_test' }, currency: 'usd', billing_type: 'renewal', billing_period: 30, initial_price: 0, renewal_price: 29, trial_period_days: null, collect_tax: true, tax_type: 'exclusive', adaptive_pricing_enabled: false, split_pay_required_payments: null, offer_cancel_discount: false };
const event = { id: 'msg_test', type: 'payment.succeeded', account_id: 'biz_test', api_version: 'v1', api_version_date: WHOP_API_VERSION_DATE, timestamp: '2026-11-09T12:00:00Z', data: { id: 'pay_test' } };
function headers(raw: string, timestamp = Math.floor(Date.now() / 1000)) { return new Headers({ 'webhook-id': event.id, 'webhook-timestamp': String(timestamp), 'webhook-signature': `v1,${createHmac('sha256', 'fixture_secret').update(`${event.id}.${timestamp}.${raw}`).digest('base64')}` }); }
function request(raw = JSON.stringify(event)) { return new NextRequest('https://example.test/api/webhooks/whop', { method: 'POST', headers: headers(raw), body: raw }); }
beforeEach(() => { vi.clearAllMocks(); mocks.receive.mockResolvedValue('pending'); mocks.process.mockResolvedValue('credited'); });
describe('minimum existing-customer receipt settlement', () => {
  it('does not admit production sales without the usable launch provider configured', () => {
    const env = { WHOP_ENVIRONMENT: 'production', WHOP_CHECKOUT_ENABLED: 'true' };
    expect(whopSalesEnabled(env)).toBe(false);
    expect(whopSalesEnabled({ ...env, WAVESPEED_API_KEY: 'fixture-configured' })).toBe(true);
    expect(whopSalesEnabled({ ...env, WAVESPEED_API_KEY: 'fixture-configured', WHOP_CHECKOUT_PAUSED: 'true' })).toBe(false);
  });
  it('requires an explicit effective card-only checkout, never inherited company defaults', () => {
    expect(() => assertCardCheckoutMethods({ enabled: ['card'], disabled: [], include_platform_defaults: false })).not.toThrow();
    for (const value of [null, {}, { enabled: ['card'], include_platform_defaults: true }, { enabled: ['card', 'crypto'], include_platform_defaults: false }, { enabled: ['card'], disabled: ['card'], include_platform_defaults: false }]) expect(() => assertCardCheckoutMethods(value)).toThrow();
  });
  it('uses exact approved paid USD receipt, plan, company and period', () => {
    expect(verifyWhopVariant(variant, plan).id).toBe(plan.planId);
    expect(verifyWhopPayment(payment, membership, plan, now)).toMatchObject({ credits: 2000, paidAt: payment.paid_at });
    for (const change of [{ account_id: 'biz_other' }, { product_id: 'prod_other' }, { variant_id: 'plan_other' }, { user: { id: 'user_other' } }, { status: 'pending' }, { currency: 'eur' }, { subtotal: money('28') }, { refunded_amount: money('1') }, { paid_at: '2026-12-01T12:00:00Z' }]) {
      expect(() => verifyWhopPayment({ ...payment, ...change }, membership, plan, now)).toThrow();
    }
    for (const change of [{ renewal_price: 1 }, { billing_period: 365 }, { initial_price: 10 }, { trial_period_days: 7 }, { collect_tax: false }, { adaptive_pricing_enabled: true }, { offer_cancel_discount: true }, { offer_cancel_discount: null }]) expect(() => verifyWhopVariant({ ...variant, ...change }, plan)).toThrow();
  });
  it('fulfills a paid receipt after cancellation or a later renewal without reactivation', () => {
    const canceled = { ...membership, status: 'canceled', current_period_end: null };
    expect(verifyWhopPayment(payment, canceled, plan, now)).toMatchObject({ membershipActive: false, paidThrough: null, credits: 2000 });
    const rolled = { ...membership, current_period_start: '2026-12-01T12:00:00Z', current_period_end: '2026-12-31T12:00:00Z' };
    expect(verifyWhopPayment(payment, rolled, plan, Date.parse('2026-12-09T12:00:00Z'))).toMatchObject({ paidAt: payment.paid_at, credits: 2000 });
  });
  it('requires exact USD purchase evidence when settlement is EUR, never guessed FX', () => {
    const eur = (amount: string) => ({ amount, currency: 'eur' });
    const converted = { ...payment, currency: 'eur', subtotal: eur('25'), total: eur('31.75'), tax_amount: eur('6.75'), refunded_amount: eur('0'),
      presentment_total: money('36.83'), presentment_tax_amount: money('7.83'), presentment_refunded_amount: money('0'),
      line_items: [{ variant_id: plan.planId, product_id: plan.productId, quantity: 1, subtotal: money('29') }] };
    expect(verifyWhopPayment(converted, membership, plan, now)).toMatchObject({ credits: 2000 });
    for (const change of [{ presentment_total: null }, { presentment_total: eur('36.83') },
      { presentment_tax_amount: null }, { presentment_refunded_amount: money('1') }, { line_items: [] }]) {
      expect(() => verifyWhopPayment({ ...converted, ...change }, membership, plan, now)).toThrow();
    }
  });
  it('classifies a real discounted receipt for explicit review, never partial credits', () => {
    expect(verifyWhopPayment({ ...payment, total: money('27.83') }, membership, plan, now))
      .toMatchObject({ reviewReason: 'discounted_receipt', paidBase: '20.00', credits: 2000 });
    expect(verifyWhopPayment(payment, membership, plan, now)).toMatchObject({ reviewReason: null, paidBase: '29.00' });
  });
  it('rejects changed raw body and stale signature before persistence', async () => {
    const raw = JSON.stringify(event);
    expect(verifyWhopWebhook(raw, headers(raw), 'fixture_secret').id).toBe(event.id);
    expect(() => verifyWhopWebhook(raw + ' ', headers(raw), 'fixture_secret')).toThrow();
    expect(() => verifyWhopWebhook(raw, headers(raw, Math.floor(Date.now() / 1000) - 301), 'fixture_secret')).toThrow();
    const response = await POST(new NextRequest('https://example.test/api/webhooks/whop', { method: 'POST', body: raw, headers: headers(raw + 'changed') }));
    expect(response.status).toBe(401); expect(mocks.receive).not.toHaveBeenCalled();
  });
  it('acknowledges only after successful durable settlement', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ code: 'credited' });
    expect(mocks.receive).toHaveBeenCalledOnce(); expect(mocks.process).toHaveBeenCalledOnce();
  });
  it('keeps failed authoritative receipt retryable after durable receipt capture', async () => {
    mocks.process.mockRejectedValueOnce(new Error('provider evidence failed'));
    const response = await POST(request());
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ code: 'RETRY_BILLING' });
    expect(mocks.receive).toHaveBeenCalledOnce();
    expect((await POST(request())).status).toBe(200);
  });
  it('never processes when receipt persistence failed', async () => {
    mocks.receive.mockRejectedValueOnce(new Error('database offline'));
    expect((await POST(request())).status).toBe(503); expect(mocks.process).not.toHaveBeenCalled();
  });
  it('acknowledges recorded event replay without another provider lookup or grant', async () => {
    mocks.receive.mockResolvedValueOnce('processed');
    expect((await POST(request())).status).toBe(200); expect(mocks.process).not.toHaveBeenCalled();
  });
});
