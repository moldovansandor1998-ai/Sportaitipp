import type { Estimate, JobType } from './types';

// A dated OPERATING estimate, not a guarantee of profit or a lifetime cost cap.
// USD net per credit = (99 - 99*1.27*0.143 - 0.40 - 2.50) / 9000.
// Fee/VAT/payout assumptions and the $0.10 non-AI budget require reconciliation.
export const OPERATING_TARIFF_VERSION = 'card-usd-2026-11-09-v1';
const NET_PACK_MICRO_USD = 78_120_610n;
const PACK_CREDITS = 9000n;
const OTHER_COST_BUDGET_MICRO_USD = 100_000n;
// This immutable authenticated account ID already owns the internal voice mappings.
const INTERNAL_OWNER_ID = '56413297-fc33-4c66-ba2f-25371a40202e';
export class CreationCostUnavailable extends Error {
  readonly code = 'CREATION_COST_UNAVAILABLE';
  constructor() { super('CREATION_COST_UNAVAILABLE'); }
}
export function customerTariffRequired(userId: string): boolean {
  return userId !== INTERNAL_OWNER_ID && (process.env.NODE_ENV === 'production'
    || process.env.CREATION_OPERATING_TARIFF_ENABLED === 'true');
}
export function hasOperatingTariff(payload: Record<string, unknown>): boolean {
  return payload.__operatingTariff === OPERATING_TARIFF_VERSION;
}
export function operatingCredits(aiMicroUsd: bigint, existingCredits: number): number {
  if (aiMicroUsd < 0n || !Number.isSafeInteger(existingCredits) || existingCredits < 1) throw new CreationCostUnavailable();
  const numerator = (11n * aiMicroUsd + OTHER_COST_BUDGET_MICRO_USD) * PACK_CREDITS;
  const needed = (numerator + NET_PACK_MICRO_USD - 1n) / NET_PACK_MICRO_USD;
  const floor = BigInt(existingCredits) > needed ? BigInt(existingCredits) : needed;
  const rounded = ((floor + 9n) / 10n) * 10n;
  if (rounded > 2_147_483_647n) throw new CreationCostUnavailable();
  return Number(rounded);
}
/** Reject unsupported workflows before preparation can call paid auxiliary services. */
export function assertCustomerCostScope(type: string, payload: Record<string, unknown>): void {
  if (payload.voiceMode === 'model' || payload.replaceVoice === true || payload.imageTalking === true
    || payload.videoRedub === true || payload.videoRedubSpeech === true || payload.useTrainedCharacter === true)
    throw new CreationCostUnavailable();
  if (type === 'image_edit' || type === 'nureta_scene_image') return;
  if (type === 'character_swap' && (payload.editModel === undefined || payload.editModel === 'seedream-v4.5')) return;
  if (type === 'character_motion_video' && payload.motionMethod === 'scene_preview') return;
  if (type === 'nureta_scene_video' && ['source', 'nureta'].includes(String(payload.voiceMode))
    && ['480p', '720p'].includes(String(payload.resolution))
    && [5, 8, 10, 12, 15].includes(Number(payload.duration))) return;
  throw new CreationCostUnavailable();
}
/** Only trusted server entry points may set this marker. Client values are discarded. */
export function tariffPayload(userId: string, type: string, input: Record<string, unknown>): Record<string, unknown> {
  const payload = { ...input };
  delete payload.__operatingTariff;
  if (customerTariffRequired(userId)) {
    assertCustomerCostScope(type, payload);
    payload.__operatingTariff = OPERATING_TARIFF_VERSION;
  }
  return payload;
}
export function operatingProvider(type: JobType, payload: Record<string, unknown>): string {
  assertCustomerCostScope(type, payload);
  return type === 'nureta_scene_video' && payload.videoEngine !== 'kling' ? 'nureta' : 'wavespeed';
}
/** Explicit provider list prices in USD. Never reverse-engineer cost from old credit rates. */
export function operatingAiMicroUsd(type: JobType, payload: Record<string, unknown>, provider: string): bigint {
  if (provider !== operatingProvider(type, payload)) throw new CreationCostUnavailable();
  if (type === 'image_edit') {
    if (!Array.isArray(payload.imageUrls) || payload.imageUrls.length !== 1
      || typeof payload.imageUrls[0] !== 'string') throw new CreationCostUnavailable();
    // https://wavespeed.ai/docs/docs-api/bytedance/bytedance-seedream-v4.5-edit
    // $0.04 per single output; public list price, not an immutable account cap.
    return 40_000n;
  }
  if (type === 'character_swap') {
    if (!Array.isArray(payload.characterImageUrls) || payload.characterImageUrls.length < 2)
      throw new CreationCostUnavailable();
    return 40_000n;
  }
  if (type === 'nureta_scene_image' || type === 'character_motion_video') return 40_000n;
  if (type === 'nureta_scene_video') {
    // https://developer.nureta.ai/pricing (native audio included).
    // https://wavespeed.ai/models/kwaivgi/kling-v3.0-pro/image-to-video (sound x1.5).
    // Nureta Seahorse: 480p $0.1888/s, 720p $0.2773/s; Kling3 PRO silent $0.112/s.
    const rate = provider === 'wavespeed' ? (payload.voiceMode === 'nureta' ? 168_000n : 112_000n) : payload.resolution === '720p' ? 277_300n : 188_800n;
    return BigInt(Number(payload.duration)) * rate;
  }
  throw new CreationCostUnavailable();
}
export function applyOperatingTariff(type: JobType, payload: Record<string, unknown>, provider: string, estimate: Estimate): Estimate {
  return hasOperatingTariff(payload)
    ? { ...estimate, credits: operatingCredits(operatingAiMicroUsd(type, payload, provider), estimate.credits) }
    : estimate;
}
