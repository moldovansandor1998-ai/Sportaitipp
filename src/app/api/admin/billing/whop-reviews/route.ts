import { NextRequest, NextResponse } from 'next/server';
import { authed } from '@/lib/apiAuth';
import { isInternalOwner } from '@/lib/security/internalAccess';
import { serviceClient } from '@/lib/supabase/server';
export const runtime = 'nodejs';
const reply = (body: unknown, status: number) => NextResponse.json(body, { status,
  headers: { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Vary: 'Authorization' } });
export async function GET(req: NextRequest) {
  try {
    const user = await authed(req); // Verified identity and server-side ban check.
    if (!user || user.is_anonymous || !user.email_confirmed_at) return reply({ code: 'AUTH_REQUIRED' }, 401);
    if (!isInternalOwner(user.email)) return reply({ code: 'OWNER_REQUIRED' }, 403);
    if (req.nextUrl.search) return reply({ code: 'UNSUPPORTED_PARAMETERS' }, 400);
    const { data, error } = await serviceClient().from('whop_card_reviews')
      .select('payment_id,membership_id,plan_id,reason,created_at,paid_base,currency').order('created_at', { ascending: false }).limit(100);
    if (error) return reply({ code: 'PAYMENT_REVIEW_UNAVAILABLE' }, 503);
    return reply({ reviews: data ?? [] }, 200);
  } catch { return reply({ code: 'PAYMENT_REVIEW_UNAVAILABLE' }, 503); }
}
