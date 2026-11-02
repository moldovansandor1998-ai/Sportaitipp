import { afterEach, expect, it, vi } from "vitest";
import { elevenLabsErrorCode, elevenLabsErrorMessage, elevenLabsSpeechHealth } from "@/lib/providers/elevenLabsStatus";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it("returns only a validated status code and never includes arbitrary provider details", async () => {
  const code = await elevenLabsErrorCode(new Response(JSON.stringify({ detail: { status: "invalid_api_key", message: "a-private-secret" } }), { status: 401 }));
  expect(code).toBe("invalid_api_key");
  expect(elevenLabsErrorMessage(code, 401)).not.toContain("a-private-secret");
  expect(await elevenLabsErrorCode(new Response(JSON.stringify({ detail: { status: "unexpected SECRET" } }), { status: 401 }))).toBe("http_401");
});
it("checks a trimmed configured key without generating or exposing account details", async () => {
  vi.stubEnv("ELEVENLABS_API_KEY", " test-key-one \n");
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ detail: { status: "invalid_api_key", message: "secret" } }), { status: 401 }));
  expect(await elevenLabsSpeechHealth()).toEqual({ configured: true, authenticated: false, available: false, code: "invalid_api_key" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1]?.headers).toEqual({ "xi-api-key": "test-key-one" });
});
it("identifies exhausted quota while keeping counts and plan details private", async () => {
  vi.stubEnv("ELEVENLABS_API_KEY", "test-key-two");
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("[]"))
    .mockResolvedValueOnce(new Response(JSON.stringify({ character_count: 100, character_limit: 100, can_extend_character_limit: false, tier: "private" })));
  expect(await elevenLabsSpeechHealth()).toEqual({ configured: true, authenticated: true, available: false, code: "quota_exceeded" });
});
it("does not block a restricted TTS key just because subscription reads are forbidden", async () => {
  vi.stubEnv("ELEVENLABS_API_KEY", "test-key-three");
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("[]")).mockResolvedValueOnce(new Response("{}", { status: 403 }));
  expect(await elevenLabsSpeechHealth()).toEqual({ configured: true, authenticated: true, available: true });
});
