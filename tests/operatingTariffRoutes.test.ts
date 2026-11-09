import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const scheduled = vi.hoisted(() => vi.fn());
vi.mock('@/server/jobs/schedule', () => ({ scheduleKick: scheduled }));
import { POST as quote } from '@/app/api/jobs/estimate/route';
import { POST as create } from '@/app/api/jobs/route';
import { runBilledTask } from '@/lib/billedTask';
const USER = '11111111-1111-4111-8111-111111111111';
const ASSET = '22222222-2222-4222-8222-222222222222';
let holds: Record<string, unknown>[];
beforeEach(() => {
  holds = []; scheduled.mockClear();
  vi.stubEnv('CREATION_OPERATING_TARIFF_ENABLED', 'true');
  vi.stubEnv('WAVESPEED_API_KEY', 'fixture');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.test');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'fixture');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fixture');
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/auth/v1/user')) return Response.json({ id: USER, email: 'customer@example.test', email_confirmed_at: '2026-01-01', is_anonymous: false });
    if (url.includes('/rest/v1/profiles')) return Response.json({ banned_until: null, age_verified_at: '2026-01-01' });
    if (url.includes('/rest/v1/whop_card_memberships')) return Response.json([]);
    if (url.includes('/rest/v1/assets')) return Response.json({ bucket: 'assets', object_path: 'owned/input.jpg' });
    if (url.includes('/storage/v1/object/sign/')) return Response.json({ signedURL: '/object/sign/assets/owned/input.jpg?token=fixture' });
    if (url.includes('/rpc/create_job_with_hold')) { holds.push(JSON.parse(String(init?.body))); return Response.json('33333333-3333-4333-8333-333333333333'); }
    throw new Error('Unexpected external call: ' + url);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const body = () => ({ type: 'image_edit', payload: { imageAssetIds: [ASSET], prompt: 'Make the sky blue', __operatingTariff: 'client-spoof' } });
const req = (data: unknown, endpoint = 'jobs') => new NextRequest(`https://example.test/api/${endpoint}`, { method: 'POST', headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' }, body: JSON.stringify(data) });
describe('existing customer upload pricing and reservation', () => {
  it('quotes then reserves exactly 70 for one owned upload without a character or prior gallery', async () => {
    const response = await quote(req(body(), 'jobs/estimate'));
    expect(response.status).toBe(200);
    const priced = await response.json();
    expect(priced).toMatchObject({ credits: 70, tariffVersion: 'card-usd-2026-11-09-v1' });
    expect(holds).toHaveLength(0);
    const created = await create(req({ ...body(), maxCredits: 70, idempotencyKey: 'upload-once' }));
    expect(created.status).toBe(202);
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({ p_owner: USER, p_character: null, p_estimated: 70,
      p_payload: { __operatingTariff: 'card-usd-2026-11-09-v1' } });
    expect(scheduled).toHaveBeenCalledOnce();
  });
  it('does not hold when the visible accepted credit amount is below the current quote', async () => {
    const response = await create(req({ ...body(), maxCredits: 69 }));
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ error: 'PRICE_CHANGED', credits: 70 });
    expect(holds).toHaveLength(0); expect(scheduled).not.toHaveBeenCalled();
  });
  it('requires explicit price acceptance before a customer reservation', async () => {
    const response = await create(req(body()));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'PRICE_CONFIRMATION_REQUIRED', credits: 70 });
    expect(holds).toHaveLength(0);
  });
  it('rejects unknown TTS costs before reservation or provider execution', async () => {
    const data = { type: 'tts', payload: { text: 'test', voice: 'Jennifer (en)' } };
    expect((await quote(req(data))).status).toBe(409);
    expect((await create(req(data))).status).toBe(409);
    const fn = vi.fn();
    expect(await runBilledTask({ userId: USER, type: 'caption', cost: 1, idempotencyKey: 'test', fn })).toEqual({ ok: false, error: 'CREATION_COST_UNAVAILABLE' });
    expect(fn).not.toHaveBeenCalled(); expect(holds).toHaveLength(0);
  });
});
