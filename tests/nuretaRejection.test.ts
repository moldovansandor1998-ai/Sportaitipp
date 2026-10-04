import { afterEach, describe, expect, it, vi } from "vitest";
import { NuretaAdapter } from "@/lib/providers/nureta";
import { ProviderError, ProviderSubmissionRejectedError } from "@/lib/providers/types";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const params = { jobId: "job", jobType: "nureta_scene_video" as const, idempotencyKey: "key",
  payload: { sceneImageUrl: "https://example.com/scene.jpg", duration: 8, resolution: "720p", prompt: "Preparing fruit" } };
describe("Nureta creation rejection", () => {
  it("retains nested account error details and marks an explicit 403 denial", async () => {
    vi.stubEnv("NURETA_API_KEY", "test-only");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: {
      code: "AccountOverdueError", message: "Insufficient balance" } }), { status: 403, headers: { "content-type": "application/json" } })));
    const failure = await new NuretaAdapter().submit(params).catch(error => error);
    expect(failure).toBeInstanceOf(ProviderSubmissionRejectedError);
    expect(failure.message).toContain("AccountOverdueError");
    expect(failure.message).toContain("Insufficient balance");
    expect(failure.message).not.toContain("[object Object]");
  });
  it("does not treat an HTTP 500 or network timeout as a proven rejection", async () => {
    vi.stubEnv("NURETA_API_KEY", "test-only");
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "Internal error" }), {
      status: 500, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", request);
    for (const networkError of [false, true]) {
      if (networkError) request.mockRejectedValue(new Error("timeout"));
      const failure = await new NuretaAdapter().submit(params).catch(error => error);
      expect(failure).toBeInstanceOf(ProviderError);
      expect(failure).not.toBeInstanceOf(ProviderSubmissionRejectedError);
      expect(failure.retryable).toBe(true);
    }
  });
});
