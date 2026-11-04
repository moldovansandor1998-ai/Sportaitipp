import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
vi.mock("@/server/reddit/client", () => ({ redditApproved: vi.fn(() => true), redditConfigured: vi.fn(() => true) }));
import { redditApproved } from "@/server/reddit/client";
import { buildRichTextPost, MAX_REDDIT_IMAGE_BYTES, uploadRedditImage } from "@/server/reddit/media";
const fetchMock = vi.fn();
let jpeg: Buffer;
const lease = (action = "//reddit-uploaded-media.s3-accelerate.amazonaws.com") => ({
  args: { action, fields: [{ name: "key", value: "rte_images/abc123" }, { name: "policy", value: "signed-policy" }, { name: "Content-Type", value: "image/jpeg" }] },
  asset: { asset_id: "abc123" },
});
beforeEach(async () => {
  vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset();
  vi.mocked(redditApproved).mockReturnValue(true);
  vi.stubEnv("REDDIT_USER_AGENT", "castora-test/1.0");
  jpeg = await sharp({ create: { width: 4, height: 4, channels: 3, background: "white" } }).jpeg().toBuffer();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("Reddit native image upload", () => {
  it("leases a JPEG and uploads only to trusted storage without bearer credentials", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(lease())).mockResolvedValueOnce(new Response("", { status: 201 }));
    await expect(uploadRedditImage("test-token", jpeg)).resolves.toEqual({ assetId: "abc123" });
    const [api, apiOptions] = fetchMock.mock.calls[0];
    expect(api).toBe("https://oauth.reddit.com/api/media/asset.json");
    expect(apiOptions.headers).toMatchObject({ Authorization: "Bearer test-token", "User-Agent": "castora-test/1.0" });
    expect(apiOptions.body.get("mimetype")).toBe("image/jpeg");
    expect(apiOptions.redirect).toBe("manual");
    const [target, storage] = fetchMock.mock.calls[1];
    expect(target).toBe("https://reddit-uploaded-media.s3-accelerate.amazonaws.com/");
    expect(storage.headers).toBeUndefined(); expect(storage.redirect).toBe("manual");
    expect(storage.body.get("file").type).toBe("image/jpeg");
  });
  it.each([
    "https://evil.example", "http://reddit-uploaded-media.s3-accelerate.amazonaws.com", "https://reddit-uploaded-media.s3-accelerate.amazonaws.com.evil.example", "https://user@reddit-uploaded-media.s3-accelerate.amazonaws.com", "https://reddit-uploaded-media.s3-accelerate.amazonaws.com:443", "https://reddit-uploaded-media.s3-accelerate.amazonaws.com?redirect=evil", "https://other-bucket.s3.amazonaws.com", "https://127.0.0.1", "//reddit-uploaded-media.s3-accelerate.amazonaws.com\\@evil.example",
  ])("rejects unsafe lease target %s", async (action) => {
    fetchMock.mockResolvedValueOnce(Response.json(lease(action)));
    await expect(uploadRedditImage("token", jpeg)).rejects.toThrow("TARGET_INVALID");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("blocks the disabled approval gate without network access", async () => {
    vi.mocked(redditApproved).mockReturnValue(false);
    await expect(uploadRedditImage("token", jpeg)).rejects.toThrow("NOT_CONFIGURED_OR_APPROVED");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects non-images, corrupt images and oversized files before requesting a lease", async () => {
    for (const value of [Buffer.from("not a jpeg"), Buffer.from([255, 216, 255, 1, 2]), Buffer.alloc(MAX_REDDIT_IMAGE_BYTES + 1)]) {
      await expect(uploadRedditImage("token", value)).rejects.toThrow(/REDDIT_IMAGE/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["file", "authorization", "success_action_redirect", "key"])("rejects dangerous/duplicate field %s", async (name) => {
    const body = lease(); body.args.fields.push({ name, value: "bad" });
    fetchMock.mockResolvedValueOnce(Response.json(body));
    await expect(uploadRedditImage("token", jpeg)).rejects.toThrow("FIELDS_INVALID");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects missing and malformed asset ids", async () => {
    for (const assetId of ["", "https://evil.example", "a/b"]) {
      const body = lease(); body.asset.asset_id = assetId;
      fetchMock.mockResolvedValueOnce(Response.json(body));
      await expect(uploadRedditImage("token", jpeg)).rejects.toThrow("ASSET_ID_INVALID");
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("does not follow redirects or return success when storage rejects the file", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(lease())).mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: "https://evil.example" } }));
    await expect(uploadRedditImage("token", jpeg)).rejects.toThrow("UPLOAD_307");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
describe("Reddit image and text post document", () => {
  it("includes a native image, literal caption, clickable Fanvue profile and AI disclosure", () => {
    const result = buildRichTextPost({ assetId: "abc123", caption: "A quiet evening [no injected markup]", fanvueUrl: "https://fanvue.com/model", modelName: "Mira" });
    expect(result.document[0]).toEqual({ e: "img", id: "abc123" });
    expect(result.document[1]).toEqual({ e: "par", c: [{ e: "text", t: "A quiet evening [no injected markup]" }] });
    expect(JSON.stringify(result)).toContain('"e":"link","u":"https://fanvue.com/model"');
    expect(JSON.stringify(result)).toContain("Mira is an AI-generated virtual model");
    expect(JSON.stringify(result)).not.toContain("supabase");
  });
  it.each(["https://fanvue.com.evil.example/model", "javascript:alert(1)", "http://fanvue.com/model", "https://user:pass@fanvue.com/model"])("rejects invalid Fanvue destination %s", (fanvueUrl) => {
    expect(() => buildRichTextPost({ assetId: "abc123", caption: "Portrait", fanvueUrl, modelName: "Mira" })).toThrow("FANVUE_URL_INVALID");
  });
});
