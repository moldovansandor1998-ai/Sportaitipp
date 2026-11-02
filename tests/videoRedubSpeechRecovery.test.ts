import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/video-redub/speech/route";
const mocks = vi.hoisted(() => ({ user: vi.fn(), service: vi.fn(), voice: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { getUser: mocks.user } }) }));
vi.mock("@/lib/supabase/server", () => ({ serviceClient: mocks.service }));
vi.mock("@/server/jobs/characterVoice", () => ({ resolveCharacterVoice: mocks.voice }));
afterEach(() => vi.resetAllMocks());
const characterId = "5ef31ec2-58fb-4564-af6d-f3679340db48";
function database(rows: unknown[]) {
  const filters: Array<[string, unknown]> = [];
  const from = vi.fn(() => {
    const row = rows.shift();
    const q = { select: () => q, eq: (key: string, value: unknown) => { filters.push([key, value]); return q; },
      is: (key: string, value: unknown) => { filters.push([key, value]); return q; }, order: () => q, limit: () => q,
      maybeSingle: async () => ({ data: row }) };
    return q;
  });
  mocks.service.mockReturnValue({ from });
  mocks.user.mockResolvedValue({ data: { user: { id: "owner" } } });
  mocks.voice.mockResolvedValue({ voiceId: "saved-voice" });
  return { filters, from };
}
it("requires sign-in before revealing a saved script or speech job", async () => {
  mocks.user.mockResolvedValue({ data: { user: null } });
  expect((await GET(new NextRequest(`https://castora.test/api/video-redub/speech?characterId=${characterId}`))).status).toBe(401);
  expect(mocks.service).not.toHaveBeenCalled();
});
it("recovers the completed same-owner, same-character and same-voice speech without generating or holding credits", async () => {
  const db = database([{ id: "speech-job", payload: { text: "Story timeee!", delivery: "girly" } }, { id: "gallery" }]);
  const request = vi.spyOn(globalThis, "fetch");
  const response = await GET(new NextRequest(`https://castora.test/api/video-redub/speech?characterId=${characterId}`));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ jobId: "speech-job", text: "Story timeee!", delivery: "girly" });
  expect(db.filters).toEqual(expect.arrayContaining([["owner_id", "owner"], ["character_id", characterId], ["status", "completed"],
    ["payload->>voiceId", "saved-voice"], ["payload->>videoRedubSpeech", "true"], ["deleted_at", null]]));
  expect(request).not.toHaveBeenCalled();
  request.mockRestore();
});
it("does not recover a foreign, failed or deleted preview", async () => {
  database([null]);
  expect((await GET(new NextRequest(`https://castora.test/api/video-redub/speech?characterId=${characterId}`))).status).toBe(404);
});
