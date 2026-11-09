import 'server-only';
import { readWhopPlans } from '@/lib/billing/whop';
import { assertApprovedSubscriptionPlans } from '@/lib/billing/subscriptionPlans';

/** Explicit sales activation is separate from accepted-payment settlement. */
export function whopConfig(env: Record<string, string | undefined> = process.env) {
  const sandbox = env.WHOP_ENVIRONMENT === 'sandbox' && env.WHOP_SANDBOX_ENABLED === 'true';
  const production = env.WHOP_ENVIRONMENT === 'production' && env.WHOP_PRODUCTION_ENABLED === 'true';
  if ((!sandbox && !production) || !env.WHOP_API_KEY || !env.WHOP_WEBHOOK_SECRET ||
      !env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const plans = readWhopPlans(env.WHOP_PLANS_JSON);
  if (plans.length !== 3 || new Set(plans.map(p => p.accountId)).size !== 1) return null;
  assertApprovedSubscriptionPlans(plans);
  return { sandbox, token: env.WHOP_API_KEY, secret: env.WHOP_WEBHOOK_SECRET, plans };
}
