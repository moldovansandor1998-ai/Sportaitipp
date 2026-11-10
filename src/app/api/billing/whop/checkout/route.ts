import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { serviceClient } from '@/lib/supabase/server';
import { whopConfig } from '@/server/billing/whop-config';
import { whopSalesEnabled } from '@/server/billing/whop-sales';
import { WhopProvider, createOpaqueWhopBinding } from '@/server/billing/whop';
import { cardRpc } from '@/server/billing/whop-card';
import { readBoundedWhopBody } from '@/server/billing/whop-webhook';
export const runtime = 'nodejs';
export const maxDuration = 30;
const reply = (code: string, status: number, extra = {}) => NextResponse.json({ code, ...extra }, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(req: NextRequest) {
  try {
    if (!whopSalesEnabled()) return reply('BILLING_PURCHASES_PAUSED', 503);
    const config = whopConfig();
    if (!config) return reply('WHOP_NOT_READY', 503);
    const token = req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return reply('AUTH_REQUIRED', 401);
    const { data: { user }, error } = await serviceClient().auth.getUser(token);
    if (error || !user || user.is_anonymous || !user.email_confirmed_at) return reply('AUTH_REQUIRED', 401);
    const parsed = z.object({ plan: z.string().max(40) }).strict().safeParse(JSON.parse(await readBoundedWhopBody(req, 1024)));
    if (!parsed.success) return reply('INVALID_REQUEST', 400);
    const plan = config.plans.find(p => p.key === parsed.data.plan);
    if (!plan) return reply('INVALID_PLAN', 400);
    let binding: unknown;
    try {
      binding = await cardRpc('whop_card_begin', { p_user: user.id, p_token: createOpaqueWhopBinding(), p_plan: plan.planId,
        p_account: plan.accountId, p_product: plan.productId, p_currency: plan.currency, p_base: plan.monthlyBasePrice, p_credits: plan.monthlyCredits });
    } catch { return reply('CHECKOUT_PENDING_OR_UNAVAILABLE', 409); }
    if (typeof binding !== 'string' || !/^[a-f0-9]{64}$/.test(binding)) throw new Error('Invalid persisted binding');
    if (!whopSalesEnabled()) return reply('BILLING_PURCHASES_PAUSED', 503);
    // Retrying the same persisted binding uses the same provider idempotency key.
    const { data: saved, error: readError } = await serviceClient().from('whop_card_bindings').select('checkout_id').eq('binding_token', binding).single();
    if (readError || !saved) throw new Error('Binding unavailable');
    const provider = new WhopProvider(config.token, config.sandbox);
    const checkout = saved.checkout_id
      ? await provider.recoverCheckout(plan, binding, saved.checkout_id)
      : await provider.createCheckout(plan, binding);
    await cardRpc('whop_card_checkout_saved', { p_token: binding, p_checkout: checkout.id });
    if (!whopSalesEnabled()) return reply('CHECKOUT_RECONCILIATION_REQUIRED', 409);
    return reply('CHECKOUT_READY', 200, { url: checkout.url, destinationEmail: user.email });
  } catch { return reply('BILLING_UNAVAILABLE', 503); }
}
