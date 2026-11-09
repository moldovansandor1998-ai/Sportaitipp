import { browserClient } from '@/lib/supabase/client';

export type OwnerFeeReport = { ok: true; text: string } | { ok: false; code: string };
const knownErrors = new Set(['AUTH_REQUIRED', 'OWNER_REQUIRED', 'WHOP_FEE_READ_NOT_CONFIGURED',
  'WHOP_FEE_READ_FORBIDDEN', 'WHOP_FEE_READ_UNAUTHORIZED', 'WHOP_FEE_READ_UNAVAILABLE', 'FEE_READ_UNAVAILABLE']);

/** Keep the existing session inside the browser; expose only the sanitized report. */
export async function loadOwnerFeeReport(signal?: AbortSignal): Promise<OwnerFeeReport> {
  try {
    const { data: { session }, error } = await browserClient().auth.getSession();
    if (error || !session?.access_token) return { ok: false, code: 'AUTH_REQUIRED' };
    const response = await fetch('/api/admin/billing/whop-fees', {
      method: 'GET', cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal,
      headers: { authorization: `Bearer ${session.access_token}`, Accept: 'application/json' },
    });
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, code: 'FEE_READ_UNAVAILABLE' };
    const value = body as Record<string, unknown>;
    if (!response.ok) return { ok: false, code: typeof value.code === 'string' && knownErrors.has(value.code)
      ? value.code : 'FEE_READ_UNAVAILABLE' };
    if (value.code !== 'WHOP_FEES_READ' || !value.schedule || typeof value.schedule !== 'object' || Array.isArray(value.schedule))
      return { ok: false, code: 'FEE_READ_UNAVAILABLE' };
    // The server validates every fee field. Never display/copy the session,
    // response headers, unknown top-level fields or arbitrary error bodies.
    const { source, apiVersionDate, retrievedAt, accountHasParent, percentageUnit, settlementCurrency,
      settlementCurrencyStatus, currentRatesArePermanentCeilings, schedule } = value;
    return { ok: true, text: JSON.stringify({ source, apiVersionDate, retrievedAt, accountHasParent,
      percentageUnit, settlementCurrency, settlementCurrencyStatus, currentRatesArePermanentCeilings, schedule }, null, 2) };
  } catch { return { ok: false, code: 'FEE_READ_UNAVAILABLE' }; }
}
