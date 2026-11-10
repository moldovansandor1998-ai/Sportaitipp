import 'server-only';
import { z } from 'zod';
import type { WhopPlan } from '@/lib/billing/whop';
import { serviceClient } from '@/lib/supabase/server';
import { WhopProvider } from './whop';
import type { WhopEvent } from './whop-webhook';

export const CARD_EVENTS = new Set(['payment.succeeded', 'membership.updated', 'membership.activated', 'refund.created', 'refund.updated', 'dispute.created', 'dispute.updated']);
export async function cardRpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await serviceClient().rpc(name, args);
  if (error) throw new Error('Card persistence unavailable');
  return data;
}
export async function receiveCardEvent(e: WhopEvent) {
  return cardRpc('whop_card_receive', { p_event: e.id, p_type: e.type, p_account: e.account_id, p_resource: e.data.id, p_at: e.timestamp });
}
/** Verified evidence is settled in a single SQL transaction, including the event acknowledgement. */
export async function processCardEvent(e: WhopEvent, plans: WhopPlan[], provider: Pick<WhopProvider, 'verifyPayment' | 'verifyReversal' | 'readMembership'>,
  rpc: typeof cardRpc = cardRpc) {
  const scoped = plans.filter(p => p.accountId === e.account_id);
  if (!scoped.length) throw new Error('Unapproved account');
  if (e.type === 'payment.succeeded') {
    const proof = await provider.verifyPayment(e.data.id, scoped);
    const plan = scoped.find(p => p.planId === proof.planId);
    if (!plan) throw new Error('Unapproved plan');
    const result = await rpc('whop_card_grant', { p_event: e.id, p_payment: proof.paymentId, p_membership: proof.membershipId,
      p_whop_user: proof.whopUserId, p_plan: plan.planId, p_account: plan.accountId, p_product: plan.productId,
      p_currency: plan.currency, p_base: plan.monthlyBasePrice, p_credits: plan.monthlyCredits,
      p_binding: typeof proof.metadata?.castora_binding === 'string' ? proof.metadata.castora_binding : null,
      p_checkout: proof.checkoutConfigurationId, p_paid: proof.paidAt, p_through: proof.paidThrough,
      p_active: proof.membershipActive, p_observed: proof.observedAt, p_review_reason: proof.reviewReason, p_paid_base: proof.paidBase });
    if (result === 'review') {
      // Normalized identifiers only: no customer data, receipt bodies or secrets.
      console.error('WHOP_CARD_PAYMENT_REVIEW: inspect /admin before further sales; verify receipt and resolve owed credits or an authorized refund.', { paymentId: proof.paymentId, membershipId: proof.membershipId, reason: proof.reviewReason ?? 'payment_review' });
    }
    return result;
  }
  if (e.type.startsWith('refund.') || e.type.startsWith('dispute.')) {
    const proof = await provider.verifyReversal(e.type.startsWith('refund.') ? 'refund' : 'dispute', e.data.id, scoped);
    // Even a pending reversal is reviewed. No automatic refund, clawback or access change.
    return rpc('whop_card_review', { p_event: e.id, p_payment: proof.paymentId, p_membership: proof.membershipId,
      p_whop_user: proof.whopUserId, p_plan: proof.planId, p_reason: proof.reason });
  }
  if (e.type === 'membership.updated' || e.type === 'membership.activated') {
    const m = z.object({ id: z.string(), account: z.object({ id: z.string() }), product_id: z.string(),
      variant_id: z.string(), user_id: z.string(), status: z.string(), updated_at: z.string().datetime() })
      .parse(await provider.readMembership(e.data.id));
    if (m.id !== e.data.id || m.account.id !== e.account_id || !scoped.some(p => p.planId === m.variant_id && p.productId === m.product_id)) throw new Error('Membership mismatch');
    return rpc('whop_card_membership_event', { p_event: e.id, p_membership: m.id, p_whop_user: m.user_id,
      p_plan: m.variant_id, p_active: m.status === 'active', p_observed: m.updated_at });
  }
  throw new Error('Unsupported event');
}
