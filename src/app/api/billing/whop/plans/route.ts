import { NextResponse } from 'next/server';
import { whopConfig } from '@/server/billing/whop-config';
import { whopSalesEnabled } from '@/server/billing/whop-sales';
import { serviceClient } from '@/lib/supabase/server';
import { WhopProvider } from '@/server/billing/whop';
export const runtime = 'nodejs';
export const maxDuration = 30;
export async function GET() {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const c = whopConfig();
    if (!c || !whopSalesEnabled()) return NextResponse.json({ ready: false, registrationReady: false, plans: [] }, { headers });
    const { error } = await serviceClient().from('whop_card_bindings').select('binding_token').limit(0);
    if (error) throw new Error('Schema unavailable');
    const provider = new WhopProvider(c.token, c.sandbox);
    await Promise.all(c.plans.map(p => provider.verifyPlan(p)));
    return NextResponse.json({ ready: true, sandbox: c.sandbox, registrationReady: false,
      plans: c.plans.map(({ key, name, currency, monthlyBasePrice, monthlyCredits }) => ({ key, name, currency, monthlyBasePrice, monthlyCredits })) }, { headers });
  } catch { return NextResponse.json({ ready: false, registrationReady: false, plans: [] }, { headers }); }
}
