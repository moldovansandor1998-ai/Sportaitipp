import { describe, expect, it } from "vitest";
import { CreateJobSchema } from "@/lib/security/validation";
const asset = "11111111-1111-4111-8111-111111111111";
const characterId = "22222222-2222-4222-8222-222222222222";
const payload = { prompt: "Walk slowly", voiceMode: "nureta", duration: 5, resolution: "720p", sceneImageAssetId: asset };
const parse = (extra: Record<string, unknown>) => CreateJobSchema.safeParse({ type: "nureta_scene_video", characterId, payload: { ...payload, ...extra } });
describe("direct uploaded scene image", () => {
  it("accepts a direct upload without a generated preview", () => { expect(parse({ sceneInputMode: "upload" }).success).toBe(true); });
  it("keeps generated scenes tied to their preview job", () => {
    expect(parse({}).success).toBe(false);
    expect(parse({ sceneJobId: asset }).success).toBe(true);
  });
  it("rejects mixed modes, missing image IDs and unknown modes", () => {
    expect(parse({ sceneInputMode: "upload", sceneJobId: asset }).success).toBe(false);
    expect(parse({ sceneInputMode: "upload", sceneImageAssetId: undefined }).success).toBe(false);
    expect(parse({ sceneInputMode: "external", sceneJobId: asset }).success).toBe(false);
  });
});
