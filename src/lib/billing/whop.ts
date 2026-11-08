import { z } from 'zod';

// Current REST schema reviewed 2026-11-07. Never infer a price from a browser input.
export const WHOP_SIGNUP_CONSENT_VERSION = 'sandbox-2026-11-07';
export const WHOP_API_VERSION_DATE = '2026-11-07';
export const whopPlanSchema = z.object({
  key: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  name: z.string().trim().min(1).max(80).optional(),
  accountId: z.string().regex(/^biz_[a-zA-Z0-9]+$/),
  productId: z.string().regex(/^prod_[a-zA-Z0-9]+$/),
  planId: z.string().regex(/^plan_[a-zA-Z0-9]+$/),
  currency: z.enum(['usd', 'eur', 'gbp', 'huf']),
  // Exact decimal major units, not floating-point minor-unit arithmetic.
  monthlyBasePrice: z.string().regex(/^\d{1,8}(\.\d{1,2})?$/),
  monthlyCredits: z.number().int().positive().max(1_000_000),
}).strict();
export type WhopPlan = z.infer<typeof whopPlanSchema>;

export function decimalMinor(value: string): bigint {
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(value)) throw new Error('Invalid money');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
}

export function readWhopPlans(raw: string | undefined): WhopPlan[] {
  if (!raw) return [];
  const plans = z.array(whopPlanSchema).min(1).max(20).parse(JSON.parse(raw));
  if (new Set(plans.map(p => p.key)).size !== plans.length ||
      new Set(plans.map(p => p.planId)).size !== plans.length ||
      plans.some(p => decimalMinor(p.monthlyBasePrice) <= 0)) throw new Error('Invalid plan allowlist');
  return plans;
}

export function safeWhopCheckoutUrl(raw: string, sandbox: boolean): string {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.hostname !== (sandbox ? 'sandbox.whop.com' : 'whop.com') ||
      url.port || url.username || url.password || !url.pathname.startsWith('/checkout/')) {
    throw new Error('Unexpected checkout destination');
  }
  return url.href;
}
