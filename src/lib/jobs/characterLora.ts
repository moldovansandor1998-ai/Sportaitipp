import "server-only";
import { serviceClient } from "@/lib/supabase/server";

export type LoraError =
  | "CHARACTER_NOT_OWNED" | "CHARACTER_NOT_ACTIVE"
  | "NO_ACTIVE_LORA" | "LORA_NOT_READY" | "PROVIDER_MODEL_INVALID";

export interface LoraResult {
  loraPath?: string;
  versionId?: string;
  provider?: string;
  error?: LoraError;
}

/** Providerfüggő LoRA-ref validáció – nincs csendben használhatatlan éles modell. */
export function validateLoraRef(provider: string | null, ref: string, isProduction: boolean):
  { ok: true; adapter: string } | { ok: false } {
  if (!provider) return { ok: false };
  if (provider === "mock") return isProduction ? { ok: false } : { ok: true, adapter: "mock" };
  if (provider === "fal") {
    // fal.ai LoRA: https://v3.fal.media/files/... formájú publikus súly-URL
    return /^https:\/\/([a-z0-9-]+\.)*fal\.media\//.test(ref) ? { ok: true, adapter: "fal" } : { ok: false };
  }
  if (provider === "replicate") {
    // Replicate TRÉNING OUTPUT formátuma: weights:// URI vagy replicate.delivery artefakt URL
    // (a tényleges adapter eredményével egyeztetve – nincs kitalált formátum)
    return /^(weights:\/\/|https:\/\/replicate\.delivery\/)/
      .test(ref) ? { ok: true, adapter: "replicate" } : { ok: false };
  }
  return { ok: false }; // ismeretlen provider elutasítva
}

/** Aktív karakter érvényes, elkészült, ADAPTERKOMPATIBILIS LoRA-refjének feloldása. */
export async function resolveCharacterLora(userId: string, characterId: string, forTestImage = false): Promise<LoraResult> {
  const sb = serviceClient();
  const { data: character } = await sb.from("characters")
    .select("id,owner_id,status,active_version_id").eq("id", characterId).single();
  const ch = character as { id: string; owner_id: string; status: string; active_version_id: string | null } | null;
  if (!ch || ch.owner_id !== userId) return { error: "CHARACTER_NOT_OWNED" };
  if (ch.status !== (forTestImage ? "test_pending" : "active")) return { error: "CHARACTER_NOT_ACTIVE" };

  let query = sb.from("character_versions")
    .select("id,provider,provider_model_ref,status")
    .eq("character_id", characterId);
  query = forTestImage
    ? query.eq("status", "test_pending").order("version_no", { ascending: false }).limit(1)
    : query.eq("id", ch.active_version_id ?? "00000000-0000-0000-0000-000000000000");
  const { data: version } = await query.maybeSingle();
  const v = version as { id: string; provider: string | null; provider_model_ref: string | null; status: string } | null;
  if (!v) return { error: "NO_ACTIVE_LORA" };
  const ref = v.provider_model_ref;
  if (!ref) return { error: "NO_ACTIVE_LORA" };
  if (v.status !== (forTestImage ? "test_pending" : "approved")) return { error: "LORA_NOT_READY" };
  const check = validateLoraRef(v.provider, ref, process.env.NODE_ENV === "production");
  if (!check.ok) return { error: "PROVIDER_MODEL_INVALID" };
  return { loraPath: ref, versionId: v.id, provider: v.provider ?? undefined };
}
