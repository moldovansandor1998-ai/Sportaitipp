import { afterEach, describe, expect, it, vi } from "vitest";
import { stat } from "node:fs/promises";

const compact = vi.hoisted(() => vi.fn());
vi.mock("@/server/jobs/compactVideo", () => ({ compactVideoFile: compact }));
import { downloadProviderFile, isRecoverableVideoStorageError } from "@/server/jobs/providerDownload";

const URL = "https://cdn.cachegalaxy.com/output.mp4";
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

function streamedMegabytes(count: number) {
  let remaining = count;
  const chunk = new Uint8Array(1024 * 1024);
  return new ReadableStream<Uint8Array>({ pull(controller) {
    if (remaining-- > 0) controller.enqueue(chunk);
    else controller.close();
  } });
}

describe("provider video downloads", () => {
  it("saves a video over the previous 100 MiB cap to disk and only returns the compact output", async () => {
    let input = "";
    compact.mockImplementation(async (path: string) => {
      input = path;
      expect((await stat(path)).size).toBe(101 * 1024 * 1024);
      return Buffer.from("compressed mp4");
    });
    const fetch = vi.fn(async () => new Response(streamedMegabytes(101), {
      headers: { "content-length": String(101 * 1024 * 1024), "content-type": "video/mp4" },
    }));
    vi.stubGlobal("fetch", fetch);
    expect(await downloadProviderFile(URL, "wavespeed", "video"))
      .toEqual({ buf: Buffer.from("compressed mp4"), contentType: "video/mp4" });
    expect(fetch.mock.calls[0]).toMatchObject([URL, { redirect: "error" }]);
    await expect(stat(input)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("enforces the video bound even without Content-Length", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(streamedMegabytes(257))));
    await expect(downloadProviderFile(URL, "wavespeed", "video")).rejects.toThrow("provider file too large");
    expect(compact).not.toHaveBeenCalled();
  });

  it("keeps the smaller image limit and cancels an oversized response before buffering", async () => {
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ cancel }), {
      headers: { "content-length": String(101 * 1024 * 1024) },
    })));
    await expect(downloadProviderFile(URL, "wavespeed", "image")).rejects.toThrow("provider file too large");
    expect(cancel).toHaveBeenCalled();
    expect(compact).not.toHaveBeenCalled();
  });

  it("removes the temporary input if compression fails", async () => {
    let input = "";
    compact.mockImplementation(async (path: string) => { input = path; throw new Error("compression failed"); });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("video")));
    await expect(downloadProviderFile(URL, "wavespeed", "video")).rejects.toThrow("compression failed");
    await expect(stat(input)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects untrusted hosts without making a request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(downloadProviderFile("https://127.0.0.1/video", "wavespeed", "video")).rejects.toThrow("URL_HOST_NOT_ALLOWED");
    expect(fetch).not.toHaveBeenCalled();
  });
});

it("recovers download and storage size failures, without retrying provider rejections", () => {
  expect(isRecoverableVideoStorageError("provider file too large")).toBe(true);
  expect(isRecoverableVideoStorageError("storage upload failed: The object exceeded the maximum allowed size")).toBe(true);
  expect(isRecoverableVideoStorageError("WaveSpeed failed: Request failed")).toBe(false);
  expect(isRecoverableVideoStorageError("URL_HOST_NOT_ALLOWED")).toBe(false);
});
