import 'server-only';
/** Sales admission only. Never use this switch for intake, claims or settlement. */
export function whopSalesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  // Production buyers must have the launch image-edit operation available.
  // This checks configuration presence only, never provider secrets or account balance.
  if (env.WHOP_ENVIRONMENT === 'production' && !env.WAVESPEED_API_KEY?.trim()) return false;
  return env.WHOP_CHECKOUT_ENABLED === 'true' && (env.WHOP_CHECKOUT_PAUSED === undefined || env.WHOP_CHECKOUT_PAUSED === 'false');
}
