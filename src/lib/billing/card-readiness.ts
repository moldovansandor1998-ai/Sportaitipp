import { SUBSCRIPTION_PLANS } from "./subscriptionPlans";
/** Sandbox readiness must never enable a real customer purchase button. */
export function cardPaymentsReady(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const state = value as { ready?: unknown; sandbox?: unknown; plans?: unknown };
  if (state.ready !== true || state.sandbox !== false || !Array.isArray(state.plans) || state.plans.length !== SUBSCRIPTION_PLANS.length) return false;
  const plans = state.plans;
  return SUBSCRIPTION_PLANS.every(expected => plans.filter((item: unknown) => {
    if (!item || typeof item !== "object") return false;
    const plan = item as Record<string, unknown>;
    return plan.key === expected.key && plan.currency === expected.currency && plan.monthlyBasePrice === expected.monthlyBasePrice && plan.monthlyCredits === expected.monthlyCredits;
  }).length === 1);
}
