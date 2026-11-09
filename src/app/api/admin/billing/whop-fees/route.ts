import { NextRequest, NextResponse } from 'next/server';
import { authed } from '@/lib/apiAuth';
import { isInternalOwner } from '@/lib/security/internalAccess';
import { readWhopAccountFees } from '@/server/billing/whop-account-fees';
export const runtime = 'nodejs';
export const maxDuration = 15;
const reply = (body: unknown, status: number) => NextResponse.json(body, { status,
  headers: { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff' } });
export async function GET(req: NextRequest) {
  try {
    // authed verifies the Supabase bearer identity and server-read profile ban.
    // Never authorize using a request email, role header or editable metadata.
    const user = await authed(req);
    if (!user || user.is_anonymous || !user.email_confirmed_at) return reply({ code: 'AUTH_REQUIRED' }, 401);
    if (!isInternalOwner(user.email)) return reply({ code: 'OWNER_REQUIRED' }, 403);
    if (req.nextUrl.search) return reply({ code: 'UNSUPPORTED_PARAMETERS' }, 400);
    const result = await readWhopAccountFees();
    return reply(result.body, result.status);
  } catch { return reply({ code: 'FEE_READ_UNAVAILABLE' }, 503); }
}
