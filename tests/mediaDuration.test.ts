import { afterEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";
import { mediaDuration } from "@/server/jobs/mediaDuration";

afterEach(() => vi.unstubAllGlobals());
it("measures audio bytes and rounds up the true duration for billing", async () => {
  const bytes = execFileSync(ffmpeg!, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "1.3", "-f", "wav", "pipe:1"]);
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(bytes)));
  expect(await mediaDuration("https://v3.fal.media/sample.wav")).toBe(2);
});
it("rejects private URLs and corrupt media without a billable estimate", async () => {
  await expect(mediaDuration("http://127.0.0.1/secret")).rejects.toThrow("URL_HOST_NOT_ALLOWED");
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("invalid media")));
  await expect(mediaDuration("https://v3.fal.media/sample.wav")).rejects.toThrow("MEDIA_INVALID");
});
