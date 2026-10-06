import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { characterIdentityVariant, applyCharacterIdentity } from "@/lib/characterIdentity";
import { WaveSpeedAdapter } from "@/lib/providers/wavespeed";
afterEach(() => vi.restoreAllMocks());
const otherIds = ["05274aae-99fa-4352-9181-519f25a54963", "5ef31ec2-58fb-4564-af6d-f3679340db48",
  "cd49b5cd-6bec-49af-bb6c-275843750e75", "407d6aa7-c688-4164-bf89-58f26e84cdf2"];
describe("stored character gender", () => {
  it("sends all four Zsofia identity references with the source scene in position two", async () => {
    const send = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({data:{id:"swap-four"}})));
    const images = ["https://example.com/face1.jpg", "https://example.com/source.jpg", "https://example.com/face2.jpg", "https://example.com/half1.jpg", "https://example.com/half2.jpg"];
    await new WaveSpeedAdapter().submit({jobId:"j",jobType:"character_swap",idempotencyKey:"k",payload:{characterImageUrls:images,editModel:"seedream-v4.5",outputCategory:"tiktok",identityPromptVariant:"zsofia-brown-eyes"}});
    const body = JSON.parse(String(send.mock.calls[0][1]?.body));
    expect(body.images).toEqual(images);
    expect(body.prompt).toContain("Images 3, 4 and 5");
    expect(body.prompt).toContain("natural brown irises in both eyes");
    expect(String(send.mock.calls[0][0])).toContain("seedream-v4.5/edit");
  });
  it("requires brown eyes only for Zsofia, including when saved as female", () => {
    const prompt = "Preserve the adult woman's face.";
    for (const gender of [undefined, "female"]) {
      const variant = characterIdentityVariant("14d3cc62-004b-43f5-a355-4939e4741e5f", gender);
      expect(variant).toBe("zsofia-brown-eyes");
      expect(applyCharacterIdentity(prompt, variant)).toContain("natural brown irises in both eyes");
    }
    for (const id of otherIds) expect(applyCharacterIdentity(prompt, characterIdentityVariant(id, "female"))).toBe(prompt);
  });
  it("adds the eye-color instruction to Zsofia's image swap without changing the request settings", async () => {
    const send = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({data:{id:"swap"}})));
    const payload = {characterImageUrls:["https://example.com/face.jpg","https://example.com/source.jpg"],editModel:"seedream-v4.5",outputCategory:"tiktok"};
    for (const variant of [undefined, characterIdentityVariant("14d3cc62-004b-43f5-a355-4939e4741e5f", "female")]) {
      await new WaveSpeedAdapter().submit({jobId:"j",jobType:"character_swap",idempotencyKey:"k",payload:{...payload,identityPromptVariant:variant}});
    }
    const original = JSON.parse(String(send.mock.calls[0][1]?.body));
    const zsofia = JSON.parse(String(send.mock.calls[1][1]?.body));
    expect({...zsofia,prompt:original.prompt}).toEqual(original);
    expect(zsofia.prompt).toContain("natural brown irises in both eyes");
    expect(original.prompt).not.toContain("natural brown irises");
  });
  it("preserves every existing model's prompt byte for byte", () => {
    const prompt = "Animate the exact adult woman. Preserve her facial identity.";
    for (const id of otherIds) {
      expect(characterIdentityVariant(id)).toBeUndefined();
      expect(applyCharacterIdentity(prompt, characterIdentityVariant(id))).toBe(prompt);
    }
  });
  it("uses a male identity only for the stable SA character ID", () => {
    const variant = characterIdentityVariant("0b3d1a82-288d-43f0-b91f-b0cf0c2261e8");
    expect(variant).toBe("male");
    const prompt = applyCharacterIdentity("The adult woman keeps her face. Change only the woman.", variant);
    expect(prompt).not.toMatch(/woman| her /);
    expect(prompt).toContain("facial hair (or lack of it)");
    expect(prompt).toContain("hair length");
  });
  it("uses saved gender for new characters without a special ID", () => {
    expect(characterIdentityVariant("new-marcell", "male")).toBe("male");
    expect(characterIdentityVariant("new-woman", "female")).toBeUndefined();
    const original = "The adult woman keeps her face.";
    expect(applyCharacterIdentity(original, characterIdentityVariant("new-woman", "female"))).toBe(original);
    expect(applyCharacterIdentity(original, characterIdentityVariant("new-marcell", "male"))).toContain("adult man");
  });
  it("changes only the identity prompt in the actual scene API request", async () => {
    const jpg = await sharp({ create: { width: 64, height: 64, channels: 3, background: "white" } }).jpeg().toBuffer();
    const send = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => options?.method === "POST"
      ? new Response(JSON.stringify({data:{id:"scene"}})) : new Response(new Uint8Array(jpg)));
    const adapter = new WaveSpeedAdapter();
    const payload = { sourceUrl:"https://example.com/source.jpg", sourceMediaType:"image",
      referenceUrls:["https://example.com/face.jpg","https://example.com/body.jpg"], scenePrompt:"" };
    for (const identityPromptVariant of [undefined,"male"]) {
      await adapter.submit({jobId:"j",jobType:"nureta_scene_image",idempotencyKey:"k",payload:{...payload,identityPromptVariant}});
    }
    const calls = send.mock.calls.filter(([, opts]) => opts?.method === "POST");
    const oldBody = JSON.parse(String(calls[0][1]?.body));
    const saBody = JSON.parse(String(calls[1][1]?.body));
    expect({...saBody,prompt:oldBody.prompt}).toEqual(oldBody);
    expect(oldBody.prompt).toContain("adult woman");
    expect(saBody.prompt).not.toContain("woman");
    expect(saBody.images).toEqual([payload.referenceUrls[0],payload.sourceUrl,payload.referenceUrls[1]]);
  });
  it("keeps the same motion settings while using the selected male identity", async () => {
    const send = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { id: "motion" } })));
    await new WaveSpeedAdapter().submit({ jobId: "j", jobType: "character_motion_video", idempotencyKey: "k",
      payload: { motionMethod: "anchored", quality: "pro", videoUrl: "https://example.com/source.mp4",
        characterImageUrl: "https://example.com/man.jpg", sceneImageUrl: "https://example.com/man.jpg",
        identityPromptVariant: characterIdentityVariant("new-marcell", "male") } });
    const body = JSON.parse(String(send.mock.calls[0][1]?.body));
    expect(body.prompt).toContain("exact adult man");
    expect(body.prompt).not.toContain("woman");
    expect(body).toMatchObject({ image: "https://example.com/man.jpg", video: "https://example.com/source.mp4",
      character_orientation: "video", keep_original_sound: true });
    expect(String(send.mock.calls[0][0])).toContain("kling-v3.0-pro/motion-control");
  });

});
