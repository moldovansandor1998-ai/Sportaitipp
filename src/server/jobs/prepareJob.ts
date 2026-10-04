import "server-only";
import { CreateJobSchema, JobTypeSchema, TTS_VOICES } from "@/lib/security/validation";
import { resolveCharacterLora, type LoraError } from "@/lib/jobs/characterLora";
import { buildEasyPrompt, normalizeEasyInput } from "@/lib/promptBuilder";
import { serviceClient } from "@/lib/supabase/server";
import { assertAllowedUrl } from "@/lib/security/ssrf";
import { resolveCharacterVoice } from "./characterVoice";
import { isAllowedI2vModel } from "@/lib/providers/modelAllowlist";

export type PrepError =
  | "validation" | "AGE_VERIFICATION_REQUIRED" | LoraError
  | "CHARACTER_REQUIRED" | "EASY_INPUT_INVALID" | "TTS_VOICE_INVALID"
  | "I2V_MODEL_NOT_ALLOWED" | "URL_NOT_ALLOWED" | "IMAGE_INPUT_REQUIRED" | "SOURCE_IMAGE_REQUIRED"
  | "TRAINED_EDIT_UNAVAILABLE" | "VIDEO_FORMAT_UNSUPPORTED" | "SCENE_PREVIEW_REQUIRED";

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
  if (type === "image_edit" && payload.galleryEdit === true && !process.env.WAVESPEED_API_KEY)
    return { type, payload: {}, error: "PROVIDER_MODEL_INVALID", status: 503 };
  if (type === "image_edit" && payload.useTrainedCharacter === true) {
    return { type, payload: {}, error: "TRAINED_EDIT_UNAVAILABLE", status: 409 };
  }
  if (type === "character_swap" && payload.useCharacterReference === true && !process.env.WAVESPEED_API_KEY) {
    return { type, payload: {}, error: "PROVIDER_MODEL_INVALID", status: 503 };
  }
  if (["video_character_swap", "character_motion_video"].includes(type) && !process.env.WAVESPEED_API_KEY)
    return { type, payload: {}, error: "PROVIDER_MODEL_INVALID", status: 503 };
  if (type === "nureta_scene_image" && !process.env.WAVESPEED_API_KEY)
    return { type, payload: {}, error: "PROVIDER_MODEL_INVALID", status: 503 };
  if (type === "nureta_scene_video" && !(payload.videoEngine === "kling" ? process.env.WAVESPEED_API_KEY : process.env.NURETA_API_KEY))
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
    && !(type === "image_edit" && (payload.useCharacterReference === true || payload.galleryEdit === true));
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
  if (type === "image_edit" && payload.galleryEdit === true) {
    if (typeof payload.galleryItemId !== "string" || !/^[0-9a-f-]{36}$/i.test(payload.galleryItemId)
        || typeof payload.prompt !== "string" || !payload.prompt.trim() || payload.prompt.length > 1500
        || payload.useCharacterReference === true || payload.useTrainedCharacter === true) {
      return { type, payload: {}, error: "validation", status: 400 };
    }
    const { data: galleryItem } = await svc.from("gallery_items")
      .select("asset_id,character_id,content_category,job_id")
      .eq("id", payload.galleryItemId).eq("owner_id", input.userId).is("deleted_at", null).maybeSingle();
    if (!galleryItem?.job_id || galleryItem.character_id !== (characterId ?? null))
      return { type, payload: {}, error: "IMAGE_INPUT_REQUIRED", status: 404 };
    const { data: sourceAsset } = await svc.from("assets")
      .select("media_type,source").eq("id", galleryItem.asset_id).eq("owner_id", input.userId).maybeSingle();
    if (sourceAsset?.media_type !== "image" || sourceAsset.source !== "generation")
      return { type, payload: {}, error: "IMAGE_INPUT_REQUIRED", status: 400 };
    payload.imageAssetIds = [galleryItem.asset_id];
    payload.outputCategory = galleryItem.content_category;
    const request = payload.prompt.trim();
    payload.prompt = `Edit the provided photo. The requested change is written in Hungarian: ${request}. `
      + "Apply only the requested change. Keep the same adult person, face, hair, body proportions, pose, framing, "
      + "background, clothing and lighting unless the request explicitly changes one of them. "
      + "Preserve the photorealistic appearance and all other details. Do not add another person or text.";
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
  if (type === "nureta_scene_image" || type === "nureta_scene_video") {
    if (!characterId) return { type, payload: {}, error: "CHARACTER_REQUIRED", status: 400 };
    const { data: character } = await svc.from("characters").select("active_version_id")
      .eq("id", characterId).eq("owner_id", input.userId).single();
    if (!character?.active_version_id) return { type, payload: {}, error: "CHARACTER_REQUIRED", status: 409 };
    const { data: version } = await svc.from("character_versions").select("id")
      .eq("id", character.active_version_id).eq("character_id", characterId).eq("status", "approved").single();
    if (!version) return { type, payload: {}, error: "CHARACTER_REQUIRED", status: 409 };
    payload.outputCategory = "fanvue";
    if (type === "nureta_scene_image") {
      const faces = await resolveCharacterFaces();
      if (!faces.length) return { type, payload: {}, error: "IMAGE_INPUT_REQUIRED", status: 409 };
      const { data: source } = await svc.from("assets").select("bucket,object_path,media_type,content_type")
        .eq("id", String(payload.sourceAssetId)).eq("owner_id", input.userId)
        .eq("media_type", String(payload.sourceMediaType)).maybeSingle();
      if (!source || (source.media_type === "video" && source.content_type !== "video/mp4"))
        return { type, payload: {}, error: "SOURCE_IMAGE_REQUIRED", status: 400 };
      const { data: signed } = await svc.storage.from(source.bucket).createSignedUrl(source.object_path, 7200);
      if (!signed?.signedUrl) return { type, payload: {}, error: "SOURCE_IMAGE_REQUIRED", status: 502 };
      payload.sourceUrl = signed.signedUrl;
      payload.referenceUrls = faces;
      payload.sourceAssetId = String(payload.sourceAssetId);
      payload.scenePrompt = typeof payload.scenePrompt === "string" ? payload.scenePrompt.trim() : "";
    } else {
      // Never accept client-injected media URLs or voice configuration.
      delete payload.sourceVideoUrl; delete payload.voiceId; delete payload.naturalHungarianVoice;
      payload.videoEngine = payload.videoEngine === "kling" ? "kling" : "nureta";
      payload.prompt = String(payload.prompt).trim();
      const { data: preview } = await svc.from("generation_jobs").select("id,type,status,payload")
        .eq("id", String(payload.sceneJobId)).eq("owner_id", input.userId)
        .eq("character_id", characterId).eq("type", "nureta_scene_image")
        .eq("status", "completed").maybeSingle();
      if (!preview) return { type, payload: {}, error: "SCENE_PREVIEW_REQUIRED", status: 409 };
      const origin = preview.payload as { sourceAssetId?: string; sourceMediaType?: string } | null;
      const sourceMediaType = origin?.sourceMediaType;
      if (payload.voiceMode === "source" || payload.voiceMode === "model" && sourceMediaType === "video") {
        if (sourceMediaType !== "video" || !origin?.sourceAssetId)
          return { type, payload: {}, error: "VIDEO_FORMAT_UNSUPPORTED", status: 400 };
        const { data: sourceVideo } = await svc.from("assets").select("bucket,object_path")
          .eq("id", origin.sourceAssetId).eq("owner_id", input.userId).eq("media_type", "video").maybeSingle();
        if (!sourceVideo) return { type, payload: {}, error: "SOURCE_IMAGE_REQUIRED", status: 404 };
        const { data: signedSource } = await svc.storage.from(sourceVideo.bucket).createSignedUrl(sourceVideo.object_path, 86400);
        if (!signedSource?.signedUrl) return { type, payload: {}, error: "SOURCE_IMAGE_REQUIRED", status: 502 };
        payload.sourceVideoUrl = signedSource.signedUrl;
      }
      if (payload.voiceMode === "model") {
        const voice = await resolveCharacterVoice(svc, characterId, input.userId);
        if (!process.env.ELEVENLABS_API_KEY || !voice?.voiceId)
          return { type, payload: {}, error: "TTS_VOICE_INVALID", status: 503 };
        payload.voiceId = voice.voiceId;
        payload.naturalHungarianVoice = voice.hungarianTts;
        if (sourceMediaType !== "video" && (!String(payload.speechText ?? "").trim()
          || String(payload.speechText).trim().length > Number(payload.duration) * 12))
          return { type, payload: {}, error: "TTS_VOICE_INVALID", status: 400 };
        payload.speechText = String(payload.speechText ?? "").trim();
      }
      const { data: chosen } = await svc.from("gallery_items")
        .select("assets!inner(bucket,object_path,media_type)")
        .eq("owner_id", input.userId).eq("job_id", preview.id)
        .eq("asset_id", String(payload.sceneImageAssetId)).eq("qc_status", "approved")
        .is("deleted_at", null).maybeSingle();
      const asset = chosen?.assets as unknown as { bucket: string; object_path: string; media_type: string } | null;
      if (asset?.media_type !== "image") return { type, payload: {}, error: "SCENE_PREVIEW_REQUIRED", status: 409 };
      const { data: signed } = await svc.storage.from(asset.bucket).createSignedUrl(asset.object_path, 7200);
      if (!signed?.signedUrl) return { type, payload: {}, error: "SCENE_PREVIEW_REQUIRED", status: 409 };
      payload.sceneImageUrl = signed.signedUrl;
      payload.duration = Number(payload.duration);
      payload.resolution = payload.resolution === "720p" ? "720p" : "480p";
    }
    // Retain the owned approved asset ID so a delayed submission can re-sign it.
  }
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
    delete payload.galleryItemId;
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
    const sourceVideoAssetId = String(payload.videoAssetId);
    const { data: video } = await svc.from("assets").select("bucket,object_path,content_type")
      .eq("id", String(payload.videoAssetId)).eq("owner_id", input.userId).eq("media_type", "video").single();
    if (!video) return { type, payload: {}, error: "SOURCE_IMAGE_REQUIRED", status: 400 };
    if (video.content_type !== "video/mp4") return { type, payload: {}, error: "VIDEO_FORMAT_UNSUPPORTED", status: 415 };
    if (payload.motionMethod === "creative" || payload.motionMethod === "talking_scene") {
      const { data: previous } = await svc.from("gallery_items").select("id")
        .eq("owner_id", input.userId).eq("asset_id", String(payload.videoAssetId))
        .eq("character_id", characterId!).eq("qc_status", "approved")
        .is("deleted_at", null).limit(1).maybeSingle();
      if (!previous) return { type, payload: {}, error: "SOURCE_IMAGE_REQUIRED", status: 409 };
    }
    const { data: character } = await svc.from("characters").select("name,active_version_id")
      .eq("id", characterId!).eq("owner_id", input.userId).single();
    if (!character?.active_version_id) return { type, payload: {}, error: "CHARACTER_REQUIRED", status: 409 };
    const { data: version } = await svc.from("character_versions").select("id")
      .eq("id", character.active_version_id).eq("character_id", characterId!).eq("status", "approved").single();
    if (!version) return { type, payload: {}, error: "CHARACTER_REQUIRED", status: 409 };
    const [{ data: signedVideo }, referenceUrls] = await Promise.all([
      svc.storage.from(video.bucket).createSignedUrl(video.object_path, 7200),
      resolveCharacterFaces(),
    ]);
    if (!referenceUrls.length) return { type, payload: {}, error: "IMAGE_INPUT_REQUIRED", status: 409 };
    if (!signedVideo?.signedUrl)
      return { type, payload: {}, error: "SOURCE_IMAGE_REQUIRED", status: 502 };
    payload.videoUrl = signedVideo.signedUrl;
    payload.characterImageUrl = referenceUrls[0];
    payload.characterImageUrls = referenceUrls;
    if (payload.motionMethod === "anchored") {
      const { data: preview } = await svc.from("generation_jobs").select("id,payload")
        .eq("id", String(payload.scenePreviewJobId)).eq("owner_id", input.userId)
        .eq("character_id", characterId!).eq("type", "character_motion_video")
        .eq("status", "completed").maybeSingle();
      const previewPayload = preview?.payload as Record<string, unknown> | undefined;
      if (previewPayload?.motionMethod !== "scene_preview" || previewPayload.sourceVideoAssetId !== sourceVideoAssetId)
        return { type, payload: {}, error: "SCENE_PREVIEW_REQUIRED", status: 409 };
      const { data: approved } = await svc.from("gallery_items").select("assets!inner(bucket,object_path,media_type)")
        .eq("job_id", preview!.id).eq("owner_id", input.userId)
        .eq("asset_id", String(payload.sceneImageAssetId)).is("deleted_at", null).maybeSingle();
      const sceneAsset = approved?.assets as unknown as { bucket: string; object_path: string; media_type: string } | null;
      if (!sceneAsset || sceneAsset.media_type !== "image")
        return { type, payload: {}, error: "SCENE_PREVIEW_REQUIRED", status: 409 };
      const { data: sceneSigned } = await svc.storage.from(sceneAsset.bucket).createSignedUrl(sceneAsset.object_path, 7200);
      if (!sceneSigned?.signedUrl) return { type, payload: {}, error: "SCENE_PREVIEW_REQUIRED", status: 409 };
      payload.sceneImageUrl = sceneSigned.signedUrl;
    }
    if (payload.motionMethod === "scene_preview") {
      payload.sourceVideoAssetId = sourceVideoAssetId;
      payload.scenePrompt = typeof payload.scenePrompt === "string" ? payload.scenePrompt.trim() : "";
      payload.voiceMode = "original";
    }
    payload.motionMethod = payload.motionMethod === "talking_scene" ? "talking_scene"
      : payload.motionMethod === "creative" ? "creative"
      : payload.motionMethod === "scene_preview" ? "scene_preview"
      : payload.motionMethod === "legacy" ? "legacy" : "anchored";
    if (payload.motionMethod === "creative") {
      payload.motionStyle = ["playful", "confident", "casual"].includes(String(payload.motionStyle))
        ? payload.motionStyle : "playful";
      // A kreatív videóhoz a beszédet külön hagyjuk jóvá; a meglévő hangcserét nem módosítjuk.
      payload.voiceMode = "original";
    }
    const voice = await resolveCharacterVoice(svc, characterId!, input.userId);
    if (payload.motionMethod === "talking_scene") {
      const voiceId = voice?.voiceId;
      if (!process.env.ELEVENLABS_API_KEY || !voiceId)
        return { type, payload: {}, error: "TTS_VOICE_INVALID", status: 503 };
      payload.voiceId = voiceId;
      payload.speechText = String(payload.speechText).trim();
      payload.motionStyle = ["playful", "confident", "casual"].includes(String(payload.motionStyle))
        ? payload.motionStyle : "playful";
      payload.voiceMode = "original";
    }
    if (payload.voiceMode !== "original") {
      const voiceId = voice?.voiceId;
      if (!process.env.ELEVENLABS_API_KEY || !voiceId)
        return { type, payload: {}, error: "TTS_VOICE_INVALID", status: 503 };
      payload.replaceVoice = true;
      payload.voiceId = voiceId;
      // The previous Dorika voice now belongs to Zsófi; keep its Hungarian TTS path with the voice.
      payload.naturalHungarianVoice = voice?.hungarianTts === true;
    }
    delete payload.voiceMode;
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
