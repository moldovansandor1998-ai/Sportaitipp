import "server-only";
import sharp from "sharp";
import { redditApproved, redditConfigured } from "./client";

// Deliberately narrower than S3 generally. Observed in PRAW's media-upload reports:
// https://github.com/praw-dev/praw/blob/main/tests/integration/cassettes/TestSubreddit.test_submit__selftext_inline_media.json
const UPLOAD_HOST = "reddit-uploaded-media.s3-accelerate.amazonaws.com";
export const MAX_REDDIT_IMAGE_BYTES = 10 * 1024 * 1024;
const ASSET_ID = /^[a-zA-Z0-9]{1,64}$/;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("REDDIT_MEDIA_LEASE_INVALID");
  return value as Record<string, unknown>;
}

function uploadUrl(action: unknown): string {
  if (typeof action !== "string" || action.length > 2048 || /[\\\s]/.test(action)) throw new Error("REDDIT_MEDIA_UPLOAD_TARGET_INVALID");
  const absolute = action.startsWith("//") ? `https:${action}` : action;
  // Reject explicit ports too, including :443 which URL otherwise normalizes away.
  if (!/^https:\/\/reddit-uploaded-media\.s3-accelerate\.amazonaws\.com\/?$/.test(absolute)) throw new Error("REDDIT_MEDIA_UPLOAD_TARGET_INVALID");
  const url = new URL(absolute);
  if (url.hostname !== UPLOAD_HOST || url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("REDDIT_MEDIA_UPLOAD_TARGET_INVALID");
  return url.href;
}

/** PRAW PostMedia uses /api/media/asset.json, args.fields, and asset.asset_id.
 * This media endpoint is undocumented by Reddit; keep the approval/configuration gate.
 * https://github.com/praw-dev/praw/blob/main/praw/models/media.py
 */
export async function uploadRedditImage(access: string, jpeg: Buffer): Promise<{ assetId: string }> {
  if (!redditApproved() || !redditConfigured()) throw new Error("REDDIT_NOT_CONFIGURED_OR_APPROVED");
  const userAgent = process.env.REDDIT_USER_AGENT?.trim();
  if (!userAgent || /[\r\n]/.test(userAgent)) throw new Error("REDDIT_USER_AGENT_NOT_CONFIGURED");
  if (!access || /\s/.test(access)) throw new Error("REDDIT_ACCESS_TOKEN_INVALID");
  if (!Buffer.isBuffer(jpeg) || jpeg.length < 4 || jpeg.length > MAX_REDDIT_IMAGE_BYTES) throw new Error("REDDIT_IMAGE_SIZE_INVALID");
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[2] !== 0xff) throw new Error("REDDIT_IMAGE_MIME_INVALID");
  try {
    const image = sharp(jpeg, { limitInputPixels: 40_000_000, failOn: "warning" });
    const metadata = await image.metadata();
    if (metadata.format !== "jpeg" || !metadata.width || !metadata.height) throw new Error("invalid image");
    await image.stats(); // Decode pixels locally, rejecting corrupt/truncated JPEGs before any upload.
  } catch { throw new Error("REDDIT_IMAGE_INVALID"); }
  const response = await fetch("https://oauth.reddit.com/api/media/asset.json", {
    method: "POST", redirect: "manual", signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${access}`, "User-Agent": userAgent, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ filepath: "post.jpg", mimetype: "image/jpeg" }),
  });
  if (!response.ok) throw new Error(`REDDIT_MEDIA_LEASE_${response.status}`);
  const lease = object(await response.json());
  const args = object(lease.args);
  const assetId = object(lease.asset).asset_id;
  if (typeof assetId !== "string" || !ASSET_ID.test(assetId)) throw new Error("REDDIT_MEDIA_ASSET_ID_INVALID");
  const target = uploadUrl(args.action);
  if (!Array.isArray(args.fields) || args.fields.length === 0 || args.fields.length > 32) throw new Error("REDDIT_MEDIA_LEASE_FIELDS_INVALID");
  const form = new FormData();
  const seen = new Set<string>();
  for (const raw of args.fields) {
    const field = object(raw);
    if (typeof field.name !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(field.name) || typeof field.value !== "string" || field.value.length > 16384 || /[\r\n\0]/.test(field.value)) throw new Error("REDDIT_MEDIA_LEASE_FIELDS_INVALID");
    const name = field.name.toLowerCase();
    if (seen.has(name) || name === "file" || name === "success_action_redirect" || name === "redirect" || name === "authorization") throw new Error("REDDIT_MEDIA_LEASE_FIELDS_INVALID");
    if (name === "content-type" && field.value !== "image/jpeg") throw new Error("REDDIT_MEDIA_LEASE_MIME_INVALID");
    seen.add(name);
    form.append(field.name, field.value);
  }
  if (form.get("key") !== `rte_images/${assetId}` || !form.get("policy")) throw new Error("REDDIT_MEDIA_LEASE_FIELDS_INVALID");
  form.append("file", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), "post.jpg");
  // Never forward bearer credentials or follow a storage redirect.
  const uploaded = await fetch(target, { method: "POST", body: form, redirect: "manual", signal: AbortSignal.timeout(30_000) });
  if (!uploaded.ok) throw new Error(`REDDIT_MEDIA_UPLOAD_${uploaded.status}`);
  return { assetId };
}

/** /api/submit accepts this as JSON.stringify(richtext), kind=self, WITHOUT text.
 * Image/link node shapes: PRAW Submission._replace_richtext_links and Reddit RTJSON.
 */
export function buildRichTextPost(input: { assetId: string; caption: string; fanvueUrl: string; modelName: string }) {
  if (!ASSET_ID.test(input.assetId)) throw new Error("REDDIT_MEDIA_ASSET_ID_INVALID");
  let url: URL;
  try { url = new URL(input.fanvueUrl); } catch { throw new Error("REDDIT_FANVUE_URL_INVALID"); }
  if (url.protocol !== "https:" || !["fanvue.com", "www.fanvue.com"].includes(url.hostname) || url.username || url.password || url.port || input.fanvueUrl.length > 2048) throw new Error("REDDIT_FANVUE_URL_INVALID");
  const caption = input.caption.trim();
  const name = input.modelName.trim();
  if (!caption || caption.length > 10000 || !name || name.length > 100) throw new Error("REDDIT_POST_TEXT_INVALID");
  return { document: [
    { e: "img", id: input.assetId },
    { e: "par", c: [{ e: "text", t: caption }] },
    { e: "par", c: [{ e: "text", t: "Fanvue profile: " }, { e: "link", u: url.href, t: "Fanvue" }] },
    { e: "par", c: [{ e: "text", t: `${name} is an AI-generated virtual model. This image is AI-generated.` }] },
  ] };
}
