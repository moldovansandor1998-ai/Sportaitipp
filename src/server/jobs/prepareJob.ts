import "server-only";
import { CreateJobSchema, JobTypeSchema, TTS_VOICES } from "@/lib/security/validation";
import { resolveCharacterLora, type LoraError } from "@/lib/jobs/characterLora";
import { buildEasyPrompt, normalizeEasyInput } from "@/lib/promptBuilder";
import { serviceClient } from "@/lib/supabase/server";
import { assertAllowedUrl } from "@/lib/security/ssrf";
import { isAllowedI2vModel } from "@/lib/providers/modelAllowlist";

export type PrepError =
  | "validation" | "AGE_VERIFICATION_REQUIRED" | LoraError
  | "CHARACTER_REQUIRED" | "EASY_INPUT_INVALID" | "TTS_VOICE_INVALID"
  | "I2V_MODEL_NOT_ALLOWED" | "URL_NOT_ALLOWED" | "IMAGE_INPUT_REQUIRED" | "SOURCE_IMAGE_REQUIRED"
  | "TRAINED_EDIT_UNAVAILABLE" | "VIDEO_FORMAT_UNSUPPORTED";

export interface PreparedJob {
  type: string;
  characterId?: string;
  projectId?: string;                 // validált, tulajdon-ellenőrzött projekt
  payload: Record<string, unknown>;   // normalizált, szerver által véglegesített provider payload
  error?: PrepError | "PROJECT_NOT_OWNED";
  status?: number;
}

export type PrepError2 = PrepError | "PROJECT_NOT_OWNED";

/** Közös input-előkészítés – az estimate ÉS a valódi job route UGYANAZT használja (árparitás). */
export async function prepareValidatedJobInput(input: {
  userId: string; type: string; characterId?: string; projectId?: string; payload: Record<string, unknown>;
}): Promise<PreparedJob> {
  // 1) séma (típus enum, jobtípusonkénti mezők, I2V tartományok, projectId UUID)
  const parsed = CreateJobSchema.safeParse({
    type: input.type, characterId: input.characterId, projectId: input.projectId, payload: input.payload,
  });
  if (!parsed.success) return { type: input.type, payload: {}, error: "validation", status: 400 };
  const type = parsed.data.type;
  const characterId = parsed.data.characterId;
  const payload: Record<string, unknown> = { ...parsed.data.payload };

  // This path produced changed compositions and an all-black output in production.
  // Reject before holding credits until a pose-preserving replacement is verified.
  if (type === "image_edit" && payload.useTrainedCharacter === true) {
    return { type, payload: {}, error: "TRAINED_EDIT_UNAVAILABLE", status: 409 };
  }
  if (type === "character_swap" && payload.useCharacterReference === true && !process.env.WAVESPEED_API_KEY) {
    return { type, payload: {}, error: "PROVIDER_MODEL_INVALID", status: 503 };
  }
  if (["video_character_swap", "character_motion_video"].includes(type) && !process.env.WAVESPEED_API_KEY)
    return { type, payload: {}, error: "PROVIDER_MODEL_INVALID", status: 503 };

  // A kliens által küldött LoRA-adatok KIZÁRÓDNEK – csak sikeres szerveroldali feloldás után kerülnek vissza
  delete payload.loraPath;
  delete payload.activeVersionId;
  delete payload.characterName;
  if (type !== "character_training") delete payload.triggerWord;

  // 1b) projekt-ownership (estimate-ben is – módosítás nélkül)
  let finalProjectId: string | undefined;
  if (parsed.data.projectId) {
    const { data: proj } = await serviceClient().from("projects")
      .select("id").eq("id", parsed.data.projectId).eq("owner_id", input.userId).single();
    if (!proj) return { type, payload, error: "PROJECT_NOT_OWNED", status: 403 };
    finalProjectId = parsed.data.projectId;
  }

  // 2) korhatár-ellenőrzés
  const svc = serviceClient();
  const { data: profile } = await svc.from("profiles")
    .select("age_verified_at").eq("id", input.userId).single();
  if (!(profile as { age_verified_at: string | null } | null)?.age_verified_at) {
    return { type, payload, error: "AGE_VERIFICATION_REQUIRED", status: 403 };
  }

  // 3) karakterkötelezettség + LoRA-injektálás (kliens loraPath SOSEM számít)
  const needsCharacter = ["image_generation", "image_edit", "test_image", "video_from_image"].includes(type)
    && !(type === "image_edit" && payload.useCharacterReference === true);
  if (type === "image_generation" && !characterId) {
    return { type, payload, error: "CHARACTER_REQUIRED", status: 400 };
  }
  let finalCharacterId: string | undefined;
  if (characterId) {
    const { data: ownedCharacter, error: ownershipError } = await svc.from("characters")
      .select("id").eq("id", characterId).eq("owner_id", input.userId).single();
    if (ownershipError || !ownedCharacter) {
      return { type, payload, error: "CHARACTER_NOT_OWNED", status: 403 };
    }
    finalCharacterId = characterId;
  }
  if (type === "image_edit" && payload.useTrainedCharacter === true && !characterId) {
    return { type, payload, error: "CHARACTER_REQUIRED", status: 400 };
  }
  if (needsCharacter && characterId) {
    const lora = await resolveCharacterLora(input.userId, characterId, type === "test_image",
      type === "image_edit" && payload.useTrainedCharacter === true);
    if (lora.error) return { type, payload, error: lora.error, status: 409 };
    if (type === "image_edit" && payload.useTrainedCharacter === true && lora.provider !== "fal") {
      return { type, payload, error: "PROVIDER_MODEL_INVALID", status: 409 };
    }
    payload.loraPath = lora.loraPath;
    payload.activeVersionId = lora.versionId;
    if (lora.provider === "fal" && (["test_image", "image_generation"].includes(type)
        || (type === "image_edit" && payload.useTrainedCharacter === true))) {
      // The LoRA trigger is fixed at training time. Renaming a character must
      // never silently change the trained token used for generation.
      const { data: version } = await serviceClient().from("character_versions")
        .select("generation_job_id").eq("id", lora.versionId).single();
      const { data: trainingJob } = version?.generation_job_id
        ? await serviceClient().from("generation_jobs").select("payload")
          .eq("id", version.generation_job_id).eq("character_id", characterId).single()
        : { data: null };
      const trainedTrigger = (trainingJob?.payload as { triggerWord?: unknown } | null)?.triggerWord;
      if (typeof trainedTrigger === "string" && /^char_[a-z0-9_]+$/.test(trainedTrigger)) {
        payload.triggerWord = trainedTrigger;
      } else {
        const { data: ch } = await serviceClient().from("characters").select("name")
          .eq("id", characterId).eq("owner_id", input.userId).single();
        if (ch?.name) {
          const slug = ch.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "character";
          payload.triggerWord = `char_${slug.replace(/-/g, "_")}`;
        }
      }
    }
  }

  // 4) Easy prompt szerveroldali felépítése
  if (payload.mode === "easy") {
    const built = buildEasyPrompt(normalizeEasyInput(payload));
    if (!built) return { type, payload, error: "EASY_INPUT_INVALID", status: 400 };
    payload.prompt = built;
  }
  if (typeof payload.triggerWord === "string" && typeof payload.prompt === "string"
      && !payload.prompt.includes(payload.triggerWord)) {
    payload.prompt = `${payload.triggerWord}, ${payload.prompt}`;
  }

  // 5) TTS voice validálás
  if (type === "tts" && payload.voice !== undefined
      && !TTS_VOICES.some((v) => v.id === payload.voice)) {
    return { type, payload, error: "TTS_VOICE_INVALID", status: 400 };
  }

  // 6) I2V modell allowlist + numerikus normalizálás
  if (type === "video_from_image") {
    if (!isAllowedI2vModel(payload.model)) {
      return { type, payload, error: "I2V_MODEL_NOT_ALLOWED", status: 400 };
    }
    if (payload.motionStrength !== undefined) payload.motionStrength = Number(payload.motionStrength);
    if (payload.cfg !== undefined) payload.cfg = Number(payload.cfg);
  }

  // 6b) Skin Enhancer / Fix Face – SZERVEROLDALI preset prompt (nano-banana edit)
  const RETOUCH_PRESETS: Record<string, string> = {
    skin_enhance: "Professional skin retouch: smooth skin, remove blemishes and redness, keep natural texture and pores, preserve identity, high-end beauty retouch.",
    fix_face: "Fix facial artifacts: correct distorted eyes, teeth and hands, symmetrical natural face, keep the same person, photorealistic.",
    pinterest_composition: "Recreate this reference composition exactly with the given character: same framing, pose, lighting, mood and color palette, but with the character as the subject.",
    motion_control: "Apply smooth cinematic camera motion to this video: gentle dolly-in with subtle parallax, keep the subject stable and consistent, natural motion blur.",
  };
  const retouchKey = ["skin_enhance", "fix_face", "pinterest_composition", "motion_control"].includes(type) ? type : null;

  // 7) képes/hangos bemenetek: asset tulajdon + signed URL; külső URL → SSRF
  const resolveImages = async (assetIds: unknown): Promise<string[]> => {
    const urls: string[] = [];
    const ids = (Array.isArray(assetIds) ? assetIds : []).filter((x): x is string => typeof x === "string");
    for (const id of ids.slice(0, 4)) {
      const { data: asset } = await svc.from("assets")
        .select("bucket,object_path").eq("id", id).eq("owner_id", input.userId).single();
      if (!asset) return [];
      const { data: signed } = await svc.storage.from((asset as { bucket: string }).bucket)
        .createSignedUrl((asset as { object_path: string }).object_path, 7200);
      if (!signed?.signedUrl) return [];
      urls.push(signed.signedUrl);
    }
    return urls;
  };
  const resolveCharacterFaces = async (): Promise<string[]> => {
    if (!characterId) return [];
    const { data: character } = await svc.from("characters")
      .select("id,active_version_id").eq("id", characterId).eq("owner_id", input.userId).single();
    if (!character) return [];
    // Retraining resets reference review; the previously approved version is still available.
    const { data: version } = character.active_version_id
      ? await svc.from("character_versions").select("id,created_at").eq("id", character.active_version_id).eq("status", "approved").maybeSingle()
      : { data: null };
    const { data: previous } = version ? await svc.from("character_versions").select("created_at")
      .eq("character_id", characterId).lt("created_at", version.created_at)
      .order("created_at", { ascending: false }).limit(1).maybeSingle() : { data: null };
    let refsQuery = svc.from("character_reference_images")
      .select("asset_id,qc_status,is_primary,kind").eq("character_id", characterId)
      .in("qc_status", ["approved"]);
    // A new approved training version must never inherit old approved reference photos.
    if (previous?.created_at) refsQuery = refsQuery.gt("uploaded_at", previous.created_at);
    const { data: refs } = await refsQuery
      .order("is_primary", { ascending: false }).order("uploaded_at", { ascending: true })
      .limit(50);
    // Face and body references from the same training set establish the character.
    let pool = refs ?? [];
    // An approved training dataset can include face photos uploaded before the
    // immediately preceding version. Fall back to the model's own approved
    // portraits when the timestamp window contains only body shots.
    if (!pool.some((r) => r.kind === "face")) {
      const { data: approvedFaces } = await svc.from("character_reference_images")
        .select("asset_id,qc_status,is_primary,kind").eq("character_id", characterId)
        .eq("qc_status", "approved").eq("kind", "face")
        .order("is_primary", { ascending: false }).order("uploaded_at", { ascending: false }).limit(5);
      pool = [...(approvedFaces ?? []), ...pool];
    }
    const selected: typeof pool = [];
    const add = (ref: (typeof pool)[number] | undefined) => {
      if (ref && !selected.some((item) => item.asset_id === ref.asset_id)) selected.push(ref);
    };
    const identityFace = pool.find((r) => r.kind === "face" && r.is_primary) ?? pool.find((r) => r.kind === "face");
    if (!identityFace) return [];
    add(identityFace);
    add(pool.find((r) => r.kind === "full_body"));
    add(pool.find((r) => r.kind === "half_body"));
    if (selected.length < 3) add(pool.find((r) => r.kind === "face" && !selected.some((item) => item.asset_id === r.asset_id)));
    if (selected.length === 0) return [];
    return resolveImages(selected.slice(0, 3).map((r) => r.asset_id));
  };
  if (type === "image_edit") {
    const urls = await resolveImages(payload.imageAssetIds);
    const external = typeof payload.externalImageUrl === "string" ? payload.externalImageUrl : null;
    if (external) {
      try { assertAllowedUrl(external); } catch { return { type, payload, error: "URL_NOT_ALLOWED", status: 400 }; }
    }
    if (urls.length === 0 && !external) return { type, payload, error: "IMAGE_INPUT_REQUIRED", status: 400 };
    if (payload.useTrainedCharacter === true && payload.useCharacterReference === true) {
      return { type, payload, error: "validation", status: 400 };
    }
    if (payload.useTrainedCharacter === true && urls.length !== 1) {
      return { type, payload, error: "IMAGE_INPUT_REQUIRED", status: 400 };
    }
    const references = payload.useCharacterReference === true ? await resolveCharacterFaces() : [];
    if (payload.useCharacterReference === true && references.length === 0) return { type, payload, error: "IMAGE_INPUT_REQUIRED", status: 409 };
    payload.imageUrls = [...urls, ...(external ? [external] : []), ...references];
    if (payload.useTrainedCharacter === true) payload.imageUrl = urls[0];
    delete payload.useCharacterReference;
    delete payload.imageAssetIds; delete payload.externalImageUrl;
  }
  // általános képfeloldó (sourceAssetId/imageAssetIds/imageUrl) – a fenti típusokhoz
  const resolveOneImage = async (p: Record<string, unknown>): Promise<string | null> => {
    const assetId = typeof p.sourceAssetId === "string" ? p.sourceAssetId
      : typeof p.imageAssetIds === "string" ? p.imageAssetIds : null;
    if (assetId) {
      const url = (await resolveImages([assetId]))[0];
      if (url) return url;
      return null;
    }
    const external = typeof p.imageUrl === "string" ? p.imageUrl : null;
    if (external) {
      try { assertAllowedUrl(external); return external; } catch { return null; }
    }
    return null;
  };
  const simpleImageTypes = ["video_to_prompt", "upscale", "background_removal", "skin_enhance", "fix_face", "pinterest_composition"];
  if (simpleImageTypes.includes(type)) {
    const extSimple = typeof payload.imageUrl === "string" ? payload.imageUrl : null;
    if (extSimple) {
      try { assertAllowedUrl(extSimple); } catch { return { type, payload, error: "URL_NOT_ALLOWED", status: 400 }; }
    }
    const url = await resolveOneImage(payload);
    if (!url) return { type, payload, error: "IMAGE_INPUT_REQUIRED", status: 400 };
    payload.imageUrl = url;
    delete payload.sourceAssetId; delete payload.imageAssetIds;
    if (retouchKey) {
      // preset → szerveroldali prompt; a típust image_edit-re fordítjuk (nano-banana)
      payload.prompt = RETOUCH_PRESETS[retouchKey];
      payload.__retouch = retouchKey;
    }
  }
  if (type === "character_swap") {
    const baseUrl = await resolveOneImage(payload);
    const characterEdit = payload.useCharacterReference === true;
    const editModel = payload.editModel === "nano-banana" ? "nano-banana" : "seedream-v4.5";
    delete payload.characterImageUrls;
    delete payload.editModel;
    const swapAssetId = typeof payload.swapAssetId === "string" ? payload.swapAssetId : null;
    const characterFaces = characterEdit ? await resolveCharacterFaces() : [];
    const swapUrl = swapAssetId ? (await resolveImages([swapAssetId]))[0]
      : characterFaces[0] ?? null;
    const swapExternal = typeof payload.swapImageUrl === "string" ? payload.swapImageUrl : null;
    let finalSwap: string | null = swapUrl ?? null;
    if (!finalSwap && swapExternal) {
      try { assertAllowedUrl(swapExternal); finalSwap = swapExternal; } catch { finalSwap = null; }
    }
    if (!baseUrl || !finalSwap) return { type, payload, error: "IMAGE_INPUT_REQUIRED", status: 400 };
    payload.imageUrl = baseUrl;
    payload.swapImageUrl = finalSwap;
    if (characterEdit) {
      const { data: identity } = await svc.from("characters").select("name")
        .eq("id", characterId!).eq("owner_id", input.userId).single();
      payload.characterName = identity?.name ?? "";
      payload.characterImageUrls = [characterFaces[0], baseUrl, ...characterFaces.slice(1)];
      payload.editModel = editModel;
    }
    delete payload.sourceAssetId; delete payload.imageAssetIds; delete payload.swapAssetId; delete payload.useCharacterReference;
  }
  if (type === "video_character_swap") {
    const { data: asset } = await svc.from("assets").select("bucket,object_path,media_type")
      .eq("id", String(payload.videoAssetId)).eq("owner_id", input.userId).eq("media_type", "video").single();
    if (!asset) return { type, payload: {}, error: "SOURCE_IMAGE_REQUIRED", status: 400 };
    const { data: signed } = await svc.storage.from(asset.bucket).createSignedUrl(asset.object_path, 7200);
    const faces = await resolveCharacterFaces();
    if (!signed?.signedUrl || !faces.length) return { type, payload: {}, error: "IMAGE_INPUT_REQUIRED", status: 409 };
    payload.videoUrl = signed.signedUrl;
    payload.faceImageUrl = faces[0];
    payload.resolution = payload.resolution === "480p" ? "480p" : "720p";
    delete payload.videoAssetId;
  }
  if (type === "character_motion_video") {
    const { data: video } = await svc.from("assets").select("bucket,object_path,content_type")
      .eq("id", String(payload.videoAssetId)).eq("owner_id", input.userId).eq("media_type", "video").single();
    if (!video) return { type, payload: {}, error: "SOURCE_IMAGE_REQUIRED", status: 400 };
    if (video.content_type !== "video/mp4") return { type, payload: {}, error: "VIDEO_FORMAT_UNSUPPORTED", status: 415 };
    const { data: character } = await svc.from("characters").select("active_version_id")
      .eq("id", characterId!).eq("owner_id", input.userId).single();
    if (!character?.active_version_id) return { type, payload: {}, error: "CHARACTER_REQUIRED", status: 409 };
    const { data: version } = await svc.from("character_versions").select("id")
      .eq("id", character.active_version_id).eq("character_id", characterId!).eq("status", "approved").single();
    if (!version) return { type, payload: {}, error: "CHARACTER_REQUIRED", status: 409 };
    const { data: refs } = await svc.from("character_reference_images")
      .select("asset_id,kind,is_primary").eq("character_id", characterId!).eq("qc_status", "approved").limit(40);
    const sorted = (refs ?? []).sort((a, b) =>
      ({ full_body: 0, half_body: 1, face: 2 }[a.kind as "full_body" | "half_body" | "face"] ?? 3)
      - ({ full_body: 0, half_body: 1, face: 2 }[b.kind as "full_body" | "half_body" | "face"] ?? 3)
      || Number(b.is_primary) - Number(a.is_primary));
    let reference: { bucket: string; object_path: string } | null = null;
    for (const ref of sorted) {
      const { data: asset } = await svc.from("assets").select("bucket,object_path")
        .eq("id", ref.asset_id).eq("owner_id", input.userId).eq("media_type", "image")
        .in("content_type", ["image/jpeg", "image/png"]).maybeSingle();
      if (asset) { reference = asset; break; }
    }
    if (!reference) return { type, payload: {}, error: "IMAGE_INPUT_REQUIRED", status: 409 };
    const [{ data: signedVideo }, { data: signedImage }] = await Promise.all([
      svc.storage.from(video.bucket).createSignedUrl(video.object_path, 7200),
      svc.storage.from(reference.bucket).createSignedUrl(reference.object_path, 7200),
    ]);
    if (!signedVideo?.signedUrl || !signedImage?.signedUrl)
      return { type, payload: {}, error: "SOURCE_IMAGE_REQUIRED", status: 502 };
    payload.videoUrl = signedVideo.signedUrl;
    payload.characterImageUrl = signedImage.signedUrl;
    payload.quality = payload.quality === "standard" ? "standard" : "pro";
    delete payload.videoAssetId;
  }
  if (type === "talking_video" || type === "lip_sync") {
    const vAsset = typeof payload.videoAssetId === "string" ? payload.videoAssetId : null;
    const vUrl = vAsset ? (await resolveImages([vAsset]))[0] : (typeof payload.videoUrl === "string" ? payload.videoUrl : null);
    const aAsset = typeof payload.audioAssetId === "string" ? payload.audioAssetId : null;
    const aUrl = aAsset ? (await resolveImages([aAsset]))[0] : (typeof payload.audioUrl === "string" ? payload.audioUrl : null);
    for (const u of [vUrl, aUrl]) {
      if (u) { try { assertAllowedUrl(u); } catch { return { type, payload, error: "URL_NOT_ALLOWED", status: 400 }; } }
    }
    if (!vUrl || !aUrl) return { type, payload, error: "SOURCE_IMAGE_REQUIRED", status: 400 };
    payload.videoUrl = vUrl; payload.audioUrl = aUrl;
    delete payload.videoAssetId; delete payload.audioAssetId;
  }
  if (type === "motion_control") {
    const vAsset = typeof payload.videoAssetId === "string" ? payload.videoAssetId : null;
    const vUrl = vAsset ? (await resolveImages([vAsset]))[0] : (typeof payload.videoUrl === "string" ? payload.videoUrl : null);
    if (!vUrl) return { type, payload, error: "SOURCE_IMAGE_REQUIRED", status: 400 };
    try { assertAllowedUrl(vUrl); } catch { return { type, payload, error: "URL_NOT_ALLOWED", status: 400 }; }
    payload.videoUrl = vUrl;
    payload.prompt = `${RETOUCH_PRESETS.motion_control} ${payload.prompt ?? ""}`.trim();
    delete payload.videoAssetId;
  }
  if (type === "video_to_video") {
    const vAsset = typeof payload.videoAssetId === "string" ? payload.videoAssetId : null;
    const vUrl = vAsset ? (await resolveImages([vAsset]))[0] : (typeof payload.videoUrl === "string" ? payload.videoUrl : null);
    if (!vUrl) return { type, payload, error: "SOURCE_IMAGE_REQUIRED", status: 400 };
    try { assertAllowedUrl(vUrl); } catch { return { type, payload, error: "URL_NOT_ALLOWED", status: 400 }; }
    payload.videoUrl = vUrl;
    delete payload.videoAssetId;
  }
  if (type === "video_from_image") {
    const assetUrl = payload.sourceAssetId
      ? (await resolveImages([payload.sourceAssetId]))[0] : undefined;
    const external = typeof payload.imageUrl === "string" ? payload.imageUrl : null;
    if (external) {
      try { assertAllowedUrl(external); } catch { return { type, payload, error: "URL_NOT_ALLOWED", status: 400 }; }
    }
    const imageUrl = assetUrl ?? external;
    if (!imageUrl) return { type, payload, error: "SOURCE_IMAGE_REQUIRED", status: 400 };
    payload.imageUrl = imageUrl;
    delete payload.sourceAssetId;
  }

  return { type, characterId: finalCharacterId, projectId: finalProjectId, payload };
}

export function parseJobType(raw: unknown): string | null {
  const r = JobTypeSchema.safeParse(raw);
  return r.success ? r.data : null;
}
