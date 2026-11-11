import { NextRequest, NextResponse } from 'next/server';
import { whopConfig } from '@/server/billing/whop-config';
import { WhopProvider } from '@/server/billing/whop';
import { verifyWhopWebhook, readBoundedWhopBody } from '@/server/billing/whop-webhook';
import { CARD_EVENTS, receiveCardEvent, processCardEvent, recoverUnrelatedMembershipRetry } from '@/server/billing/whop-card';
export const runtime = 'nodejs';
export const maxDuration = 30;
const reply = (status: number, code: string) => NextResponse.json({ code }, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(req: NextRequest) {
  let c;
  try { c = whopConfig(); } catch { return reply(503, 'WHOP_NOT_READY'); }
  if (!c) return reply(503, 'WHOP_NOT_READY');
  if (Number(req.headers.get('content-length')) > 262144) return reply(413, 'TOO_LARGE');
  let e;
  try { e = verifyWhopWebhook(await readBoundedWhopBody(req), req.headers, c.secret); }
  catch { return reply(401, 'INVALID_WEBHOOK'); }
  if (!c.plans.some(p => p.accountId === e.account_id)) return reply(403, 'UNAPPROVED_ACCOUNT');
  if (!CARD_EVENTS.has(e.type)) return reply(200, 'ignored');
  try {
    const provider = new WhopProvider(c.token, c.sandbox);
    let status;
    try { status = await receiveCardEvent(e); }
    catch { return reply(200, await recoverUnrelatedMembershipRetry(e, c.plans, provider)); }
    if (status !== 'pending') return reply(200, 'duplicate');
    const outcome = await processCardEvent(e, c.plans, provider);
    return reply(200, String(outcome));
  } catch {
    // Normalized receipt remains pending. Provider retry and authenticated drain
    // can recover. Never acknowledge an unverified payment as fulfilled.
    return reply(503, 'RETRY_BILLING');
  }
}
