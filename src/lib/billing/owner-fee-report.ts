import { browserClient } from '@/lib/supabase/client';

export type OwnerFeeReport = { ok: true; text: string } | { ok: false; code: string; detail?: string };
const knownErrors = new Set(['AUTH_REQUIRED', 'OWNER_REQUIRED', 'WHOP_FEE_READ_NOT_CONFIGURED',
  'WHOP_FEE_READ_FORBIDDEN', 'WHOP_FEE_READ_UNAUTHORIZED', 'WHOP_FEE_READ_UNAVAILABLE', 'FEE_READ_UNAVAILABLE',
  'WHOP_FEE_HTTP_ERROR', 'WHOP_FEE_SCHEMA_MISMATCH', 'WHOP_FEE_RESPONSE_INVALID', 'WHOP_FEE_TIMEOUT', 'WHOP_FEE_NETWORK_ERROR']);

function diagnosticDetail(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  const value = raw as Record<string, unknown>;
  if (!['http', 'network', 'json', 'schema'].includes(String(value.stage))) return;
  const detail: Record<string, unknown> = { stage: value.stage };
  if (typeof value.upstreamStatus === 'number' && Number.isInteger(value.upstreamStatus) && value.upstreamStatus >= 100 && value.upstreamStatus <= 599) detail.upstreamStatus = value.upstreamStatus;
  if (['empty', 'too_large', 'invalid_json', 'invalid_encoding'].includes(String(value.reason))) detail.reason = value.reason;
  if (typeof value.issueCount === 'number' && Number.isInteger(value.issueCount) && value.issueCount >= 0 && value.issueCount <= 10000) detail.issueCount = value.issueCount;
  if (Array.isArray(value.issues)) detail.issues = value.issues.slice(0, 8).flatMap(issue => {
    if (!issue || typeof issue !== 'object') return [];
    const { path, code } = issue as Record<string, unknown>;
    if (typeof path !== 'string' || !/^[a-z0-9_.<>]{1,200}$/.test(path) || typeof code !== 'string' || !/^[a-z_]{1,40}$/.test(code)) return [];
    return [{ path, code }];
  });
  return JSON.stringify(detail);
}

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
    if (!response.ok) {
      const code = typeof value.code === 'string' && knownErrors.has(value.code) ? value.code : 'FEE_READ_UNAVAILABLE';
      const detail = code === 'FEE_READ_UNAVAILABLE' ? undefined : diagnosticDetail(value.diagnostic);
      return { ok: false, code, ...(detail ? { detail } : {}) };
    }
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
