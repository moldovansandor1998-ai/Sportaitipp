import { describe, it, expect } from "vitest";
import { CreateJobSchema } from "@/lib/security/validation";

const base = { characterId: "9b2b0c6e-7c1a-4f2e-9d3b-1a2b3c4d5e6f" };

describe("jobtípusonkénti payload-validáció (400 a kreditlevonás előtt)", () => {
  it("image_generation: karakter kötelező (route-szint, DB is kényszerít)", () => {
    // a séma karakterId opcionális marad (route kezeli), de image_edit/i2v/tts bemenetek:
  });
  it("image_edit: kép nélkül elutasítva (kreditfoglalás előtt)", () => {
    expect(CreateJobSchema.safeParse({ ...base, type: "image_edit", payload: { prompt: "x" } }).success).toBe(false);
    expect(CreateJobSchema.safeParse({ ...base, type: "image_edit", payload: { prompt: "x", imageAssetIds: ["a1"] } }).success).toBe(true);
    expect(CreateJobSchema.safeParse({ ...base, type: "image_edit", payload: { prompt: "x", externalImageUrl: "https://fal.media/a.png" } }).success).toBe(true);
  });
  it("video_from_image: forráskép kötelező", () => {
    expect(CreateJobSchema.safeParse({ ...base, type: "video_from_image", payload: { prompt: "x" } }).success).toBe(false);
    expect(CreateJobSchema.safeParse({ ...base, type: "video_from_image", payload: { prompt: "x", sourceAssetId: "a1" } }).success).toBe(false);   // nem UUID
    expect(CreateJobSchema.safeParse({ ...base, type: "video_from_image", payload: { prompt: "x", sourceAssetId: "9b2b0c6e-7c1a-4f2e-9d3b-1a2b3c4d5e6f" } }).success).toBe(true);
    // tartományok: duration/aspectRatio/motionStrength/cfg
    const okPayload = { prompt: "x", sourceAssetId: "9b2b0c6e-7c1a-4f2e-9d3b-1a2b3c4d5e6f", model: "m" };
    expect(CreateJobSchema.safeParse({ ...base, type: "video_from_image", payload: { ...okPayload, duration: 7 } }).success).toBe(false);
    expect(CreateJobSchema.safeParse({ ...base, type: "video_from_image", payload: { ...okPayload, duration: 5, aspectRatio: "21:9" } }).success).toBe(false);
    expect(CreateJobSchema.safeParse({ ...base, type: "video_from_image", payload: { ...okPayload, motionStrength: 999 } }).success).toBe(false);
    expect(CreateJobSchema.safeParse({ ...base, type: "video_from_image", payload: { ...okPayload, cfg: 2 } }).success).toBe(false);
    expect(CreateJobSchema.safeParse({ ...base, type: "video_from_image", payload: { ...okPayload, duration: 10, aspectRatio: "16:9", motionStrength: 120, cfg: 0.5 } }).success).toBe(true);
  });
  it("tts: ismeretlen voice elutasítva", () => {
    expect(CreateJobSchema.safeParse({ ...base, type: "tts", payload: { text: "Szia", voice: "Nem létező (xx)" } }).success).toBe(false);
    expect(CreateJobSchema.safeParse({ ...base, type: "tts", payload: { text: "Szia", voice: "Jennifer (en)" } }).success).toBe(true);
  });
  it("character_training: destination + EGYSÉGES dataset-mező (imagesDataUrl VAGY imagesZipUrl, XOR)", () => {
    expect(CreateJobSchema.safeParse({ ...base, type: "character_training", payload: {} }).success).toBe(false);
    expect(CreateJobSchema.safeParse({ ...base, type: "character_training", payload: { destination: "me/x", imagesDataUrl: "data:...zip", versionId: "9b2b0c6e-7c1a-4f2e-9d3b-1a2b3c4d5e6f" } }).success).toBe(true);
    expect(CreateJobSchema.safeParse({ ...base, type: "character_training", payload: { destination: "me/x", imagesZipUrl: "https://signed.example/d.zip", versionId: "9b2b0c6e-7c1a-4f2e-9d3b-1a2b3c4d5e6f" } }).success).toBe(true);
    // mindkettő VAGY egyik sem → hiba
    expect(CreateJobSchema.safeParse({ ...base, type: "character_training", payload: { destination: "me/x", imagesDataUrl: "a", imagesZipUrl: "b", versionId: "9b2b0c6e-7c1a-4f2e-9d3b-1a2b3c4d5e6f" } }).success).toBe(false);
    expect(CreateJobSchema.safeParse({ ...base, type: "character_training", payload: { destination: "me/x" } }).success).toBe(false);
    // versionId kötelező (prep-claimelt verzió)
    expect(CreateJobSchema.safeParse({ ...base, type: "character_training", payload: { destination: "me/x", imagesDataUrl: "data:x" } }).success).toBe(false);
  });
  it("reference_qc: nem üres string-tömb", () => {
    expect(CreateJobSchema.safeParse({ ...base, type: "reference_qc", payload: {} }).success).toBe(false);
    expect(CreateJobSchema.safeParse({ ...base, type: "reference_qc", payload: { refIds: ["a", "b"] } }).success).toBe(true);
  });
  it("image_generation / video_from_image / tts prompt+változók", () => {
    expect(CreateJobSchema.safeParse({ ...base, type: "image_generation", payload: {} }).success).toBe(false);
    expect(CreateJobSchema.safeParse({ ...base, type: "image_generation", payload: { prompt: "x" } }).success).toBe(true);
    expect(CreateJobSchema.safeParse({ ...base, type: "video_from_image", payload: { prompt: "x" } }).success).toBe(false);
    expect(CreateJobSchema.safeParse({ ...base, type: "video_from_image", payload: { prompt: "x", imageUrl: "https://fal.media/a.png" } }).success).toBe(true);
    expect(CreateJobSchema.safeParse({ ...base, type: "tts", payload: { text: "Szia" } }).success).toBe(true);
  });
  it("talking_video/lip_sync: videoUrl + audioUrl", () => {
    expect(CreateJobSchema.safeParse({ ...base, type: "lip_sync", payload: { videoUrl: "v" } }).success).toBe(false);
    expect(CreateJobSchema.safeParse({ ...base, type: "lip_sync", payload: { videoUrl: "v", audioUrl: "a" } }).success).toBe(true);
  });
});
