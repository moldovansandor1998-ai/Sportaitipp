import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyOperatingTariff, assertCustomerCostScope, customerTariffRequired, operatingAiMicroUsd,
  operatingCredits, tariffPayload, OPERATING_TARIFF_VERSION } from '@/lib/providers/operatingTariff';
import { ProviderRouter } from '@/lib/providers/router';
import type { ProviderAdapter } from '@/lib/providers/types';
const CUSTOMER = '11111111-1111-4111-8111-111111111111';
const OWNER = '56413297-fc33-4c66-ba2f-25371a40202e';
afterEach(() => vi.unstubAllEnvs());
describe('conditional operating tariff', () => {
  it('uses exact rational net-credit value and rounds up to ten without discounting an existing tariff', () => {
    expect(operatingCredits(40_000n, 40)).toBe(70);
    expect(operatingCredits(1_386_500n, 458)).toBe(1770);
    expect(operatingCredits(4_159_500n, 1373)).toBe(5290);
    expect(operatingCredits(672_000n, 222)).toBe(870);
    expect(operatingCredits(5_040_000n, 1512)).toBe(6400);
    expect(operatingCredits(40_000n, 111)).toBe(120);
    expect(() => operatingCredits(-1n, 40)).toThrow();
    expect(() => operatingCredits(1n, Infinity)).toThrow();
  });
  it('cannot disable production pricing and preserves only the exact owner account', () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('CREATION_OPERATING_TARIFF_ENABLED', 'false');
    expect(customerTariffRequired(CUSTOMER)).toBe(true);
    expect(customerTariffRequired(OWNER)).toBe(false);
    expect(tariffPayload(OWNER, 'tts', { __operatingTariff: OPERATING_TARIFF_VERSION })).toEqual({});
    expect(tariffPayload(CUSTOMER, 'image_edit', { __operatingTariff: 'forged' }).__operatingTariff).toBe(OPERATING_TARIFF_VERSION);
  });
  it('rejects unknown auxiliary AI, workflows and durations instead of pricing them at zero', () => {
    for (const [type, payload] of [
      ['tts', { text: 'hello' }], ['character_training', {}], ['image_generation', {}],
      ['nureta_scene_video', { voiceMode: 'model', duration: 5, resolution: '720p' }],
      ['character_motion_video', { motionMethod: 'anchored' }],
      ['character_swap', { editModel: 'nano-banana' }],
      ['nureta_scene_video', { voiceMode: 'source', duration: Infinity, resolution: '720p' }],
    ] as const) expect(() => assertCustomerCostScope(type, payload)).toThrow('CREATION_COST_UNAVAILABLE');
  });
  it('costs explicit verified model rates, not old credits divided by a multiplier', () => {
    const payload = { voiceMode: 'source', duration: 15, resolution: '720p', videoEngine: 'nureta' };
    expect(operatingAiMicroUsd('nureta_scene_video', payload, 'nureta')).toBe(4_159_500n);
    expect(operatingAiMicroUsd('nureta_scene_video', { ...payload, voiceMode: 'nureta' }, 'nureta')).toBe(4_159_500n);
    expect(operatingAiMicroUsd('nureta_scene_video', { ...payload, videoEngine: 'kling', voiceMode: 'nureta' }, 'wavespeed')).toBe(2_520_000n);
    expect(() => operatingAiMicroUsd('nureta_scene_video', payload, 'wavespeed')).toThrow();
    expect(() => operatingAiMicroUsd('image_edit', { imageUrls: ['a', 'b'] }, 'wavespeed')).toThrow();
  });
  it('pins a costed image edit to WaveSpeed with no paid fallback', async () => {
    vi.stubEnv('CREATION_OPERATING_TARIFF_ENABLED', 'true');
    const payload = tariffPayload(CUSTOMER, 'image_edit', { imageUrls: ['https://example.test/a.jpg'], prompt: 'edit' });
    const ws = { name: 'wavespeed', supports: ['image_edit'], estimate: vi.fn(async () => ({ credits: 40, secondsExpected: 60 })), submit: vi.fn(async () => { throw new Error('uncertain'); }) } as unknown as ProviderAdapter;
    const fal = { name: 'fal', supports: ['image_edit'], submit: vi.fn() } as unknown as ProviderAdapter;
    const router = new ProviderRouter([fal, ws], () => 'fal');
    expect(router.candidates('image_edit', payload).map(a => a.name)).toEqual(['wavespeed']);
    expect((await router.estimate('image_edit', payload)).credits).toBe(70);
    await expect(router.submit('image_edit', { jobId: 'job', jobType: 'image_edit', payload, idempotencyKey: 'key' })).rejects.toThrow('uncertain');
    expect(ws.submit).toHaveBeenCalledOnce(); expect(fal.submit).not.toHaveBeenCalled();
  });
  it('keeps legacy unmarked estimates unchanged', () => {
    expect(applyOperatingTariff('tts', {}, 'fal', { credits: 20, secondsExpected: 60 }).credits).toBe(20);
  });
});
