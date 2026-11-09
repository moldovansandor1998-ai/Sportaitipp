import 'server-only';
import { NextResponse } from 'next/server';
import { whopConfig } from '@/server/billing/whop-config';
import { whopSalesEnabled } from '@/server/billing/whop-sales';
import { serviceClient } from '@/lib/supabase/server';
import { WhopProvider, whopReadinessDiagnostic } from '@/server/billing/whop';
export const runtime = 'nodejs';
export const maxDuration = 30;

type ReadinessStage = 'config_missing_or_invalid' | 'sales_gate' | 'database_schema' | 'provider_verification';
const databaseErrorCodes = new Set(['42P01', '42703', '42501', 'PGRST204', 'PGRST205', 'PGRST301']);

function logUnavailable(stage: ReadinessStage, error?: unknown) {
  // Never log errors, messages, provider bodies, configuration or customer data.
  const rawCode = stage === 'database_schema' && error && typeof error === 'object' && 'code' in error ? error.code : null;
  const code = typeof rawCode === 'string' && databaseErrorCodes.has(rawCode) ? rawCode : 'unknown';
  const provider = stage === 'provider_verification' ? whopReadinessDiagnostic(error) : undefined;
  console.warn('[whop-plans] not ready', { stage, code, ...(provider ? { provider } : {}) });
}

export async function GET() {
  const headers = { 'Cache-Control': 'no-store' };
  let stage: ReadinessStage = 'config_missing_or_invalid';
  const unavailable = (error?: unknown) => {
    logUnavailable(stage, error);
    return NextResponse.json({ ready: false, registrationReady: false, plans: [] }, { headers });
  };
  try {
    const c = whopConfig();
    if (!c) return unavailable();
    stage = 'sales_gate';
    if (!whopSalesEnabled()) return unavailable();
    stage = 'database_schema';
    const { error } = await serviceClient().from('whop_card_bindings').select('binding_token').limit(0);
    if (error) return unavailable(error);
    stage = 'provider_verification';
    const provider = new WhopProvider(c.token, c.sandbox);
    await Promise.all(c.plans.map(p => provider.verifyPlan(p)));
    return NextResponse.json({ ready: true, sandbox: c.sandbox, registrationReady: false,
      plans: c.plans.map(({ key, name, currency, monthlyBasePrice, monthlyCredits }) => ({ key, name, currency, monthlyBasePrice, monthlyCredits })) }, { headers });
  } catch (error) { return unavailable(error); }
}
