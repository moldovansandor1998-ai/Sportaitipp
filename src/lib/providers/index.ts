import { MockProvider } from "./mock";
import { FalAdapter } from "./fal";
import { ReplicateAdapter } from "./replicate";
import { WaveSpeedAdapter } from "./wavespeed";
import { ProviderRouter } from "./router";
import { JobType, ProviderAdapter, ProviderError } from "./types";

// PRODUCTION-ben a MockProvider egyáltalán nem kerül be az adapterlistába –
// akkor sem, ha valós kulcs jelen van. A mock kizárólag dev/test környezetben
// engedélyezett; a PROVIDER_ALLOW_MOCK_PRODUCTION=true egy KÜLÖN, veszélyes
// override (csak helyi tesztelésre, soha ne állítsd be éles környezetben).
export function buildRouter(extra: ProviderAdapter[] = []): ProviderRouter {
  const real: ProviderAdapter[] = [];
  if (process.env.FAL_KEY) real.push(new FalAdapter());
  if (process.env.REPLICATE_API_TOKEN) real.push(new ReplicateAdapter());
  if (process.env.WAVESPEED_API_KEY) real.push(new WaveSpeedAdapter());

  // PRODUCTION-ben a mock SEMMILYEN kapcsolóval nem engedélyezhető.
  const isProd = process.env.NODE_ENV === "production";
  const allowMock = !isProd && process.env.PROVIDER_ALLOW_MOCK !== "false";

  const adapters: ProviderAdapter[] = allowMock ? [new MockProvider(), ...real] : [...real];
  adapters.push(...extra);

  if (adapters.length === 0) {
    // Fail-closed: nincs konfigurált provider – minden kérés azonnal, egyértelműen elbukik
    return new ProviderRouter([], () => "none", {}) as unknown as ProviderRouter;
  }

  const primaryFor = (jobType: JobType): string => {
    if (real.length > 0) {
      if ((jobType === "character_swap" || jobType === "video_character_swap") && real.some((a) => a.name === "wavespeed")) return "wavespeed";
      const fal = real.find((a) => a.name === "fal");
      if (fal && fal.supports.includes(jobType)) return "fal";
      const rep = real.find((a) => a.name === "replicate");
      if (rep && rep.supports.includes(jobType)) return "replicate";
    }
    return "mock";
  };
  return new ProviderRouter(adapters, primaryFor, { timeoutMs: 120_000, breakerThreshold: 3 });
}

export function assertProviderConfigured(router: ProviderRouter, jobType: JobType): void {
  if (router.candidates(jobType).length === 0) {
    throw new ProviderError(`NO_PROVIDER_CONFIGURED for ${jobType}`, false, undefined, "unknown");
  }
}

export type { ProviderAdapter, JobType, NormalizedOutput, Estimate } from "./types";
export { ProviderError } from "./types";
