import type { WhopPlan } from './whop';

// Approved retail allowances. Provider account/product/variant IDs are configured separately.
export const SUBSCRIPTION_PLANS = [
  { key: 'starter', name: 'Starter', monthlyBasePrice: '29.00', currency: 'usd', monthlyCredits: 2000 },
  { key: 'creator', name: 'Creator', monthlyBasePrice: '49.00', currency: 'usd', monthlyCredits: 4000 },
  { key: 'studio', name: 'Studio', monthlyBasePrice: '99.00', currency: 'usd', monthlyCredits: 9000 },
] as const;

export function assertApprovedSubscriptionPlans(plans: WhopPlan[]) {
  for (const plan of plans) {
    const approved = SUBSCRIPTION_PLANS.find(candidate => candidate.key === plan.key);
    if (!approved || plan.currency !== approved.currency ||
      Number(plan.monthlyBasePrice) !== Number(approved.monthlyBasePrice) ||
      plan.monthlyCredits !== approved.monthlyCredits) throw new Error('Unapproved subscription price or credits');
  }
}
