import 'server-only';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { decimalMinor, safeWhopCheckoutUrl, WHOP_API_VERSION_DATE, type WhopPlan } from '@/lib/billing/whop';

const id = z.string().min(4).max(128);
const money = z.object({ amount: z.string(), currency: z.string() });
const cardMethods = z.object({ enabled: z.tuple([z.literal('card')]), disabled: z.array(z.string()).optional(), include_platform_defaults: z.literal(false) });
export function assertCardCheckoutMethods(raw: unknown) {
  const effective = cardMethods.parse(raw);
  if (effective.disabled?.includes('card')) throw new Error('Card checkout unavailable');
}
const checkoutSchema = z.object({ id, account_id: id, mode: z.literal('payment'), variant: z.object({ id }),
  purchase_url: z.string(), metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  effective_payment_method_configuration: z.unknown() });
const variantSchema = z.object({
  id, account: z.object({ id }), product: z.object({ id }), currency: z.string(),
  billing_type: z.literal('renewal'), billing_period: z.literal(30),
  initial_price: z.literal(0), renewal_price: z.number().positive(),
  trial_period_days: z.union([z.literal(0), z.null()]),
  collect_tax: z.literal(true), tax_type: z.literal('exclusive'),
  // This release settles only exact USD receipts. Localized pricing could
  // otherwise accept a different currency and leave a paid buyer uncredited.
  adaptive_pricing_enabled: z.literal(false), split_pay_required_payments: z.null(),
  offer_cancel_discount: z.literal(false),
});
const membershipSchema = z.object({
  id, account: z.object({ id }), product_id: id, variant_id: id, user_id: id,
  status: z.enum(['active', 'trialing', 'past_due', 'completed', 'canceled', 'expired', 'unresolved', 'drafted', 'canceling']),
  current_period_end: z.string().datetime().nullable(), updated_at: z.string().datetime(),
});
const paymentSchema = z.object({
  id, account_id: id, product_id: id, variant_id: id, membership_id: id,
  user: z.object({ id }), status: z.literal('paid'), substatus: z.literal('succeeded'),
  billing_reason: z.enum(['subscription_create', 'subscription_cycle']),
  paid_at: z.string().datetime(), currency: z.string(), subtotal: money, total: money,
  tax_amount: money.nullable(), tax_behavior: z.literal('exclusive').nullable(), refunded_amount: money,
  presentment_total: money.nullable().optional(), presentment_tax_amount: money.nullable().optional(),
  presentment_refunded_amount: money.nullable().optional(),
  line_items: z.array(z.object({ variant_id: id.nullable(), product_id: id.nullable(), quantity: z.number(), subtotal: money.nullable() })).optional(),
  customer_email: z.string().email().nullable().optional(), checkout_configuration_id: id.nullable(), metadata: z.record(z.string(), z.unknown()).nullable(),
});

export function verifyWhopVariant(raw: unknown, plan: WhopPlan) {
  const variant = variantSchema.parse(raw);
  if (variant.id !== plan.planId || variant.account.id !== plan.accountId ||
      variant.product.id !== plan.productId || variant.currency !== plan.currency ||
      decimalMinor(String(variant.renewal_price)) !== decimalMinor(plan.monthlyBasePrice)) {
    throw new Error('Whop plan mismatch');
  }
  return variant;
}

/** Evidence only. Does NOT bind an app user, grant access, or award credits. */
export function verifyWhopPayment(rawPayment: unknown, rawMembership: unknown, plan: WhopPlan, now = Date.now()) {
  const payment = paymentSchema.parse(rawPayment);
  const membership = membershipSchema.parse(rawMembership);
  const base = decimalMinor(plan.monthlyBasePrice);
  const amounts = [payment.subtotal, payment.total, payment.refunded_amount, ...(payment.tax_amount ? [payment.tax_amount] : [])];
  if (amounts.some(m => m.currency !== payment.currency) ||
      payment.account_id !== plan.accountId || membership.account.id !== plan.accountId ||
      payment.product_id !== plan.productId || membership.product_id !== plan.productId ||
      payment.variant_id !== plan.planId || membership.variant_id !== plan.planId ||
      payment.membership_id !== membership.id || payment.user.id !== membership.user_id ||
      decimalMinor(payment.refunded_amount.amount) !== BigInt(0)) throw new Error('Whop payment mismatch');
  // Payment.currency and ordinary money fields use SETTLEMENT currency, which
  // may be EUR even for a USD checkout. Use exact USD presentment evidence plus
  // the purchased line-item snapshot, never an estimated FX conversion.
  let subtotal = payment.subtotal;
  let total = payment.total;
  let tax = payment.tax_amount;
  if (payment.currency !== plan.currency) {
    const item = payment.line_items?.length === 1 ? payment.line_items[0] : null;
    if (!item || item.variant_id !== plan.planId || item.product_id !== plan.productId || item.quantity !== 1 ||
        !item.subtotal || !payment.presentment_total || !payment.presentment_refunded_amount ||
        decimalMinor(payment.total.amount) <= BigInt(0)) throw new Error('Missing exact purchase-currency evidence');
    subtotal = item.subtotal;
    total = payment.presentment_total;
    tax = payment.presentment_tax_amount ?? null;
  }
  const presented = [payment.presentment_total, payment.presentment_tax_amount, payment.presentment_refunded_amount].filter(m => m != null);
  const taxMinor = tax ? decimalMinor(tax.amount) : BigInt(0);
  const paidBase = decimalMinor(total.amount) - taxMinor;
  if ([subtotal, total, ...(tax ? [tax] : []), ...presented].some(m => m.currency !== plan.currency) ||
      (payment.presentment_refunded_amount && decimalMinor(payment.presentment_refunded_amount.amount) !== BigInt(0)) ||
      (payment.presentment_total && decimalMinor(payment.presentment_total.amount) !== decimalMinor(total.amount)) ||
      (payment.tax_behavior === null && tax !== null && decimalMinor(tax.amount) !== BigInt(0)) ||
      (payment.currency !== plan.currency && decimalMinor(payment.tax_amount?.amount ?? '0') > BigInt(0) && !tax) ||
      decimalMinor(subtotal.amount) !== base || paidBase < BigInt(0) || paidBase > base) {
    throw new Error('Whop payment amount mismatch');
  }
  // A receipt is evidence that money moved. Today's membership period/status
  // cannot invalidate an earlier paid purchase or identify that receipt's period.
  // Credit units are bought per distinct receipt, not for inferred access windows.
  if (Date.parse(payment.paid_at) > now) throw new Error('Whop payment time mismatch');
  return { paymentId: payment.id, membershipId: membership.id, whopUserId: membership.user_id,
    paidThrough: membership.current_period_end, membershipActive: membership.status === 'active',
    checkoutConfigurationId: payment.checkout_configuration_id, metadata: payment.metadata,
    reviewReason: paidBase < base ? 'discounted_receipt' as const : null,
    paidBase: `${paidBase / BigInt(100)}.${(paidBase % BigInt(100)).toString().padStart(2, '0')}`,
    paidAt: payment.paid_at, customerEmail: payment.customer_email ?? null, planId: plan.planId, credits: plan.monthlyCredits, observedAt: membership.updated_at };
}

export function createOpaqueWhopBinding() { return randomBytes(32).toString('hex'); }

/** Sandbox provider adapter. Caller persists the server-owned binding before checkout creation. */
export class WhopProvider {
  constructor(private readonly token: string, private readonly sandbox = true, private readonly fetcher = fetch) {
    if (!token) throw new Error('Whop is not configured');
  }
  protected async request(path: string, body?: object, idempotencyKey?: string): Promise<unknown> {
    const response = await this.fetcher(`${this.sandbox ? 'https://sandbox-api.whop.com' : 'https://api.whop.com'}/api/v1/${path}`, {
      method: body ? 'POST' : 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(4000),
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json',
        'Api-Version-Date': WHOP_API_VERSION_DATE, ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error('Whop request failed'); // Never log provider bodies or customer data.
    const raw = await response.text();
    if (raw.length > 1_000_000) throw new Error('Whop response too large');
    return JSON.parse(raw);
  }
  async listPaymentPage(plan: Pick<WhopPlan, 'accountId' | 'planId'>, lane: 'paid' | 'refunds' | 'disputes', start: string, end: string, after: string | null) {
    const prefix = lane === 'paid' ? 'created' : lane === 'refunds' ? 'refunded' : 'dispute_created';
    const query = new URLSearchParams({ account_id: plan.accountId, variant_id: plan.planId, first: '50',
      order: 'created_at', direction: 'asc', [`${prefix}_after`]: start, [`${prefix}_before`]: end });
    if (lane === 'paid') query.set('status', 'paid');
    if (after) query.set('after', after);
    return z.object({ data: z.array(z.object({ id: z.string().regex(/^pay_[a-zA-Z0-9]+$/), updated_at: z.string().datetime() })).max(50),
      page_info: z.object({ has_next_page: z.boolean(), end_cursor: z.string().max(4096).nullable() }) }).parse(await this.request(`payments?${query}`));
  }
  async reviewPayment(paymentId: string, plans: WhopPlan[]) {
    if (!/^pay_[a-zA-Z0-9]+$/.test(paymentId)) throw new Error('Invalid payment ID');
    const payment = z.object({ id, account_id: id, membership_id: id, variant_id: id, product_id: id,
      user: z.object({ id }), status: z.string(), substatus: z.string(), currency: z.string(), refunded_amount: money, paid_at: z.string().datetime().nullable() }).parse(await this.request(`payments/${paymentId}`));
    const plan = plans.find(p => p.planId === payment.variant_id && p.accountId === payment.account_id && p.productId === payment.product_id);
    if (!plan || payment.id !== paymentId || payment.refunded_amount.currency !== payment.currency) throw new Error('Payment scope mismatch');
    return { paymentId, accountId: plan.accountId, planId: plan.planId, membershipId: payment.membership_id, whopUserId: payment.user.id,
      paidAt: payment.paid_at, paid: payment.status === 'paid' && payment.substatus === 'succeeded',
      revoke: decimalMinor(payment.refunded_amount.amount) > BigInt(0) || /dispute|resolution|refund/.test(payment.substatus) };
  }
  async verifyReversal(kind: 'refund' | 'dispute', eventResourceId: string, plans: WhopPlan[]) {
    const pattern = kind === 'refund' ? /^rf_[a-zA-Z0-9]+$/ : /^dspt_[a-zA-Z0-9]+$/;
    if (!pattern.test(eventResourceId)) throw new Error('Invalid reversal ID');
    const raw = await this.request(`${kind === 'refund' ? 'refunds' : 'disputes'}/${eventResourceId}`);
    const reversal = z.object({ id, account_id: id, payment_id: id.optional(), payment: z.object({ id }).optional() }).parse(raw);
    if (reversal.id !== eventResourceId) throw new Error('Reversal mismatch');
    const paymentId = kind === 'refund' ? reversal.payment_id : reversal.payment?.id;
    if (!paymentId || !/^pay_[a-zA-Z0-9]+$/.test(paymentId)) throw new Error('Missing reversal payment');
    const payment = z.object({ id, account_id: id, membership_id: id, variant_id: id, product_id: id,
      user: z.object({ id }), substatus: z.string(), currency: z.string(), refunded_amount: money }).parse(await this.request(`payments/${paymentId}`));
    const plan = plans.find(p => p.planId === payment.variant_id && p.accountId === payment.account_id && p.productId === payment.product_id);
    if (!plan || payment.id !== paymentId || reversal.account_id !== plan.accountId || payment.refunded_amount.currency !== payment.currency) throw new Error('Reversal scope mismatch');
    const revoke = decimalMinor(payment.refunded_amount.amount) > BigInt(0) || /dispute|resolution|refund/.test(payment.substatus);
    return { paymentId, membershipId: payment.membership_id, whopUserId: payment.user.id, planId: plan.planId,
      revoke, reason: kind === 'refund' ? 'provider_refund' : 'provider_dispute' };
  }
  async readMembership(membershipId: string) {
    if (!/^mem_[a-zA-Z0-9]+$/.test(membershipId)) throw new Error('Invalid membership ID');
    return this.request(`memberships/${membershipId}`);
  }
  async verifyPlan(plan: WhopPlan) {
    return verifyWhopVariant(await this.request(`variants/${encodeURIComponent(plan.planId)}`), plan);
  }
  async verifyPayment(paymentId: string, plans: WhopPlan | WhopPlan[]) {
    if (!/^pay_[a-zA-Z0-9]+$/.test(paymentId)) throw new Error('Invalid payment ID');
    const payment = paymentSchema.parse(await this.request(`payments/${paymentId}`));
    if (payment.id !== paymentId) throw new Error('Payment ID mismatch');
    const plan = (Array.isArray(plans) ? plans : [plans]).find(p => p.planId === payment.variant_id);
    if (!plan) throw new Error('Unapproved plan');
    if (!/^mem_[a-zA-Z0-9]+$/.test(payment.membership_id)) throw new Error('Invalid membership ID');
    const membership = await this.request(`memberships/${payment.membership_id}`);
    // The allowlisted purchase snapshot, not today's mutable variant settings,
    // defines settlement. Closing sales or disabling a variant must not strand receipts.
    return verifyWhopPayment(payment, membership, plan);
  }
  async recoverCheckout(plan: WhopPlan, persistedBinding: string, checkoutId: string) {
    if (!/^[a-f0-9]{64}$/.test(persistedBinding) || !/^ch_[a-zA-Z0-9]+$/.test(checkoutId)) throw new Error('Invalid checkout binding');
    await this.verifyPlan(plan);
    const result = checkoutSchema
      .parse(await this.request(`checkout_configurations/${checkoutId}`));
    if (result.id !== checkoutId || result.account_id !== plan.accountId || result.variant.id !== plan.planId || result.metadata?.castora_binding !== persistedBinding) throw new Error('Checkout mismatch');
    assertCardCheckoutMethods(result.effective_payment_method_configuration);
    return { id: result.id, url: safeWhopCheckoutUrl(result.purchase_url, this.sandbox) };
  }
  async createCheckout(plan: WhopPlan, persistedBinding: string) {
    if (!/^[a-f0-9]{64}$/.test(persistedBinding)) throw new Error('Invalid checkout binding');
    await this.verifyPlan(plan);
    const result = checkoutSchema
      .parse(await this.request('checkout_configurations', { account_id: plan.accountId, variant_id: plan.planId,
        mode: 'payment', payment_method_configuration: { enabled: ['card'], disabled: [], include_platform_defaults: false }, metadata: { castora_binding: persistedBinding } }, `castora-${persistedBinding}`));
    if (result.account_id !== plan.accountId || result.variant.id !== plan.planId || result.metadata?.castora_binding !== persistedBinding) throw new Error('Checkout mismatch');
    assertCardCheckoutMethods(result.effective_payment_method_configuration);
    return { id: result.id, url: safeWhopCheckoutUrl(result.purchase_url, this.sandbox) };
  }
}
