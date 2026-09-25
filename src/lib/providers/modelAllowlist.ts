// Szerver által engedélyezett modellek – a config route ÉS a jobs route is ezt használja.
export interface AllowedModel { id: string; label: string; }

export function allowedI2vModels(): AllowedModel[] {
  const isProd = process.env.NODE_ENV === "production";
  const hasFal = Boolean(process.env.FAL_KEY);
  const hasRep = Boolean(process.env.REPLICATE_API_TOKEN);
  if (hasFal) return [{ id: "kling-v2.1-i2v", label: "Kling 2.1 Image-to-Video (fal.ai)" }];
  if (hasRep) return [{ id: "seedance-1-pro", label: "Seedance 1 Pro (Replicate)" }];
  if (!isProd) return [{ id: "mock-i2v", label: "Mock motor (teszt)" }];
  return [];
}

export function isAllowedI2vModel(model: unknown): boolean {
  return typeof model === "string" && allowedI2vModels().some((m) => m.id === model);
}
