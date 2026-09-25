import { z } from "zod";

export const CreateCharacterSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(2000).optional(),
  consentType: z.enum(["ai_persona", "self", "third_party_documented"]),
  isSpicy: z.boolean().default(false),
});

// Támogatott TTS voice-ok (fal.ai PlayHT) – a szerver ezt validálja a kreditlevonás ELŐTT
export const TTS_VOICES = [
  { id: "Jennifer (en)", label: "Jennifer – angol (női)", lang: "en" },
  { id: "Dexter (en)", label: "Dexter – angol (férfi)", lang: "en" },
  { id: "Arista (hu)", label: "Arista – magyar (női)", lang: "hu" },
] as const;

const validImageInput = (p: Record<string, unknown>): boolean =>
  (typeof p.sourceAssetId === "string" && /^[0-9a-f-]{36}$/i.test(p.sourceAssetId))
  || (typeof p.imageAssetIds === "string" && /^[0-9a-f-]{36}$/i.test(p.imageAssetIds))
  || (typeof p.imageUrl === "string" && p.imageUrl.trim().length > 0);

const req = (payload: Record<string, unknown>, key: string, ctx: z.RefinementCtx, label: string): void => {
  if (typeof payload[key] !== "string" || (payload[key] as string).length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label}: '${key}' kötelező string mező` });
  }
};

export const JOB_TYPES = [
  "reference_qc","character_training","test_image","identity_check",
  "image_generation","image_edit","upscale","background_removal","skin_enhance","fix_face","pinterest_composition",
  "video_from_image","video_to_video","talking_video","character_swap","motion_control","lip_sync",
  "tts","video_to_prompt","captioning","frame_extract","dataset_generation",
  "carousel_page","viral_scene","ppv_render",
] as const;
export const JobTypeSchema = z.enum(JOB_TYPES);

export const CreateJobSchema = z.object({
  type: JobTypeSchema,
  characterId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  payload: z.record(z.unknown()).default({}),
  idempotencyKey: z.string().min(8).max(120).optional(),
}).superRefine((val, ctx) => {
  // Jobtípusonkénti payload-validáció – hiány esetén 400, kredit NEM vonódik le
  const p = val.payload as Record<string, unknown>;
  switch (val.type) {
    case "character_training": {
      // fal.ai returns a weights URL; only Replicate needs a destination model.
      if (typeof p.versionId !== "string" || p.versionId.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "character_training: 'versionId' kötelező (prep által claimelt verzió)" });
      }
      // EGYSÉGES dataset-mező: data URL VAGY signed zip URL (XOR kötelező)
      const dataUrl = typeof p.imagesDataUrl === "string" && p.imagesDataUrl.length > 0;
      const zipUrl = typeof p.imagesZipUrl === "string" && p.imagesZipUrl.length > 0;
      if (dataUrl === zipUrl) {   // mindkettő vagy egyik sem → hiba
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "character_training: pontosan az egyik kell: imagesDataUrl VAGY imagesZipUrl" });
      }
      break;
    }
    case "reference_qc": {
      const ids = p.refIds;
      if (!Array.isArray(ids) || ids.length === 0 || ids.some((x) => typeof x !== "string")) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "reference_qc: 'refIds' nem üres string-tömb kell" });
      }
      break;
    }
    case "image_generation":
    case "test_image":
      if (p.mode === "easy") {
        const sizes = ["square_hd", "portrait_4_3", "landscape_4_3"];
        if (p.imageSize !== undefined && !sizes.includes(String(p.imageSize))) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `image_generation: ismeretlen imageSize '${String(p.imageSize)}'` });
        }
        const n = Number(p.numImages);
        if (p.numImages !== undefined && (!Number.isInteger(n) || n < 1 || n > 4)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "image_generation: numImages 1–4 közötti egész szám" });
        }
      } else {
        req(p, "prompt", ctx, val.type);
      }
      break;
    case "image_edit": {
      // legalább egy érvényes bemeneti kép KÖTELEZÓ (asset vagy SSRF-szűrt külső URL)
      const hasAsset = Array.isArray(p.imageAssetIds) && (p.imageAssetIds as unknown[]).some((x) => typeof x === "string");
      const hasExternal = typeof p.externalImageUrl === "string" && (p.externalImageUrl as string).length > 0;
      if (!hasAsset && !hasExternal) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "image_edit: legalább egy bemeneti kép kell (imageAssetIds vagy externalImageUrl)" });
      }
      req(p, "prompt", ctx, val.type);
      break;
    }
    case "pinterest_composition": {
      if (!validImageInput(p)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "pinterest_composition: referenciakép kötelező" });
      req(p, "prompt", ctx, val.type);
      break;
    }
    case "video_from_image": {
      const hasAsset = typeof p.sourceAssetId === "string" && /^[0-9a-f-]{36}$/i.test(p.sourceAssetId);
      const hasExternal = typeof p.imageUrl === "string" && (p.imageUrl as string).length > 0;
      if (!hasAsset && !hasExternal) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "video_from_image: érvényes forráskép kötelező (sourceAssetId UUID vagy imageUrl)" });
      }
      req(p, "prompt", ctx, val.type);
      // tartományok: duration/aspectRatio/motionStrength/cfg (a szerver normalizál számmá)
      const d = Number(p.duration);
      if (p.duration !== undefined && (!Number.isInteger(d) || ![5, 10].includes(d))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "video_from_image: duration csak 5 vagy 10" });
      }
      const ratios = ["16:9", "9:16", "1:1"];
      if (p.aspectRatio !== undefined && !ratios.includes(String(p.aspectRatio))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `video_from_image: aspectRatio ${ratios.join("/")}` });
      }
      const ms = Number(p.motionStrength);
      if (p.motionStrength !== undefined && (!Number.isFinite(ms) || ms < 1 || ms > 255)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "video_from_image: motionStrength 1–255" });
      }
      const cfg = Number(p.cfg);
      if (p.cfg !== undefined && (!Number.isFinite(cfg) || cfg < 0 || cfg > 1)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "video_from_image: cfg 0–1" });
      }
      break;
    }
    case "video_to_prompt":
    case "upscale":
    case "background_removal":
      // képes bemenet: asset (UUID) vagy SSRF-szűrt külső URL – a route oldja fel
      if (!validImageInput(p)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${val.type}: érvényes bemeneti kép kötelező (sourceAssetId vagy imageUrl)` });
      }
      break;
    case "character_swap": {
      if (p.editModel !== undefined && p.editModel !== "seedream-v4.5" && p.editModel !== "nano-banana") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "character_swap: ismeretlen szerkesztő modell" });
      }
      if (!validImageInput(p)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "character_swap: alapkép kötelező (sourceAssetId vagy imageUrl)" });
      }
      const sw = p.swapImageUrl ?? p.swapAssetId;
      if ((!val.characterId || p.useCharacterReference !== true) && (typeof sw !== "string" || sw.length === 0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "character_swap: cserefotó kötelező (swapAssetId vagy swapImageUrl)" });
      }
      break;
    }
    case "talking_video":
    case "lip_sync": {
      const hasVideo = typeof p.videoUrl === "string" || typeof p.videoAssetId === "string";
      const hasAudio = typeof p.audioUrl === "string" || typeof p.audioAssetId === "string";
      if (!hasVideo || !hasAudio) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${val.type}: videó + hang kötelező` });
      }
      break;
    }
    case "video_to_video": {
      const hasVideo = typeof p.videoUrl === "string" || typeof p.videoAssetId === "string";
      if (!hasVideo) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "video_to_video: forrásvideó kötelező" });
      req(p, "prompt", ctx, val.type);
      break;
    }
    case "motion_control": {
      const hasVideo = typeof p.videoUrl === "string" || typeof p.videoAssetId === "string";
      if (!hasVideo) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "motion_control: forrásvideó kötelező" });
      req(p, "prompt", ctx, val.type);
      break;
    }
    case "skin_enhance":
    case "fix_face": {
      // preset-alapú retus (nano-banana edit) – kép kötelező
      if (!validImageInput(p)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${val.type}: érvényes kép kötelező` });
      }
      break;
    }
    case "tts": {
      req(p, "text", ctx, val.type);
      if (p.voice !== undefined && !TTS_VOICES.some((v) => v.id === p.voice)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `tts: ismeretlen voice '${String(p.voice)}'` });
      }
      if (p.speed !== undefined) {
        const sp = Number(p.speed);
        if (!Number.isFinite(sp) || sp < 0.5 || sp > 2) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "tts: speed 0.5–2 között" });
        }
      }
      if (p.language !== undefined && !["auto", "en", "hu", "de", "es", "fr"].includes(String(p.language))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `tts: ismeretlen language '${String(p.language)}'` });
      }
      break;
    }
  }
});

export const ReferenceImageSchema = z.object({
  characterId: z.string().uuid(),
  assetId: z.string().uuid(),
  kind: z.enum(["face", "half_body", "full_body"]).default("face"),
});

// Fájl-ellenőrzés feltöltés előtt (kliens is validál, szerver a storage policy-val erősít)
export const UPLOAD_LIMITS = {
  maxBytes: 15 * 1024 * 1024,
  allowedMime: ["image/jpeg", "image/png", "image/webp"],
} as const;

export function assertUploadable(file: { size: number; type: string }) {
  if (file.size > UPLOAD_LIMITS.maxBytes) throw new Error("FILE_TOO_LARGE");
  if (!(UPLOAD_LIMITS.allowedMime as readonly string[]).includes(file.type)) throw new Error("FILE_TYPE_NOT_ALLOWED");
}
