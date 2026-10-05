import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { characterIdentityVariant, applyCharacterIdentity } from "@/lib/characterIdentity";
import { WaveSpeedAdapter } from "@/lib/providers/wavespeed";
afterEach(() => vi.restoreAllMocks());
const otherIds = ["05274aae-99fa-4352-9181-519f25a54963", "5ef31ec2-58fb-4564-af6d-f3679340db48",
  "cd49b5cd-6bec-49af-bb6c-275843750e75", "407d6aa7-c688-4164-bf89-58f26e84cdf2", "14d3cc62-004b-43f5-a355-4939e4741e5f"];
describe("stored character gender", () => {
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
});
