import 'server-only';
import { z } from 'zod';
import { unwrapWebhook } from '@whop/sdk/helpers';
import { WHOP_API_VERSION_DATE } from '@/lib/billing/whop';

export const whopEventSchema = z.object({ id: z.string().max(128), type: z.string().max(128),
  api_version: z.literal('v1'), api_version_date: z.literal(WHOP_API_VERSION_DATE),
  account_id: z.string(), timestamp: z.string().datetime(), data: z.object({ id: z.string().max(128) }) });
export type WhopEvent = z.infer<typeof whopEventSchema>;
export async function readBoundedWhopBody(request: Request, limit = 262144): Promise<string> {
  if (!request.body) throw new Error('Missing body');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('Body too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}

export function verifyWhopWebhook(raw: string, headers: Headers, secret: string): WhopEvent {
  if (Buffer.byteLength(raw) > 262144) throw new Error('Webhook too large');
  const event = whopEventSchema.parse(unwrapWebhook(raw, { headers: Object.fromEntries(headers), key: secret }));
  if (event.id !== headers.get('webhook-id')) throw new Error('Webhook ID mismatch');
  return event;
}
