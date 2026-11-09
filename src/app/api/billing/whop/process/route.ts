import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/security/cron';
import { serviceClient } from '@/lib/supabase/server';
import { WHOP_API_VERSION_DATE } from '@/lib/billing/whop';
import { whopConfig } from '@/server/billing/whop-config';
import { WhopProvider } from '@/server/billing/whop';
import { processCardEvent } from '@/server/billing/whop-card';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(req: NextRequest) {
  if (isCronAuthorized(req.headers.get('authorization'), process.env.CRON_SECRET) !== 'ok')
    return NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });
  try {
    const c = whopConfig();
    if (!c) return NextResponse.json({ processed: 0 });
    const db = serviceClient();
    const { data, error } = await db.from('whop_card_events').select('*').eq('status', 'pending').order('attempts').order('created_at').limit(3);
    if (error) throw new Error('Persistence unavailable');
    let processed = 0;
    for (const row of data ?? []) {
      await db.from('whop_card_events').update({ attempts: row.attempts + 1 }).eq('event_id', row.event_id);
      try {
        await processCardEvent({ id: row.event_id, type: row.event_type, account_id: row.account_id,
          data: { id: row.resource_id }, timestamp: row.event_timestamp, api_version: 'v1', api_version_date: WHOP_API_VERSION_DATE }, c.plans, new WhopProvider(c.token, c.sandbox));
        processed++;
      } catch { /* Preserve pending receipt for later retry and operator review. */ }
    }
    return NextResponse.json({ processed, pendingAttempted: (data?.length ?? 0) - processed }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ code: 'RETRY_BILLING' }, { status: 503 }); }
}
