import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

export const X_CALLBACK = "https://sportaitipp.vercel.app/api/x/callback";

function key() {
  const secret = process.env.X_TOKEN_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) throw new Error("X_TOKEN_ENCRYPTION_KEY_NOT_CONFIGURED");
  return createHash("sha256").update(secret).digest();
}

export function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}

export function decrypt(value: string) {
  const data = Buffer.from(value, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key(), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
}

export function xConfigured() {
  return Boolean(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET && process.env.X_TOKEN_ENCRYPTION_KEY);
}

function authHeaders() {
  const clientId = process.env.X_CLIENT_ID;
  const secret = process.env.X_CLIENT_SECRET;
  if (!clientId || !secret) throw new Error("X_CLIENT_NOT_CONFIGURED");
  return { Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}` };
}

export async function exchangeCode(code: string, verifier: string) {
  const response = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST", headers: { ...authHeaders(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier,
      redirect_uri: X_CALLBACK }), signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`X_TOKEN_EXCHANGE_${response.status}`);
  return response.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number }>;
}

export async function refreshToken(refresh: string) {
  const response = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST", headers: { ...authHeaders(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`X_TOKEN_REFRESH_${response.status}`);
  return response.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number }>;
}

export async function xIdentity(accessToken: string) {
  const response = await fetch("https://api.x.com/2/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`X_ACCOUNT_LOOKUP_${response.status}`);
  const body = await response.json() as { data?: { id?: string; username?: string } };
  if (!body.data?.id || !body.data?.username) throw new Error("X_ACCOUNT_LOOKUP_INVALID");
  return body.data as { id: string; username: string };
}

export async function xUploadAndPost(accessToken: string, jpeg: Buffer, text: string) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const form = new FormData();
  form.append("media", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), "post.jpg");
  form.append("media_category", "tweet_image");
  const upload = await fetch("https://api.x.com/2/media/upload", {
    method: "POST", headers, body: form, signal: AbortSignal.timeout(30_000),
  });
  if (!upload.ok) throw new Error(`X_MEDIA_UPLOAD_${upload.status}`);
  const media = await upload.json() as { data?: { id?: string; media_id?: string }; media_id?: string; media_id_string?: string };
  const mediaId = media.data?.id ?? media.data?.media_id ?? media.media_id_string ?? media.media_id;
  if (!mediaId) throw new Error("X_MEDIA_ID_MISSING");
  const post = await fetch("https://api.x.com/2/tweets", {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ text, media: { media_ids: [mediaId] } }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!post.ok) throw new Error(`X_POST_${post.status}`);
  const result = await post.json() as { data?: { id?: string } };
  if (!result.data?.id) throw new Error("X_POST_ID_MISSING");
  return result.data.id;
}
