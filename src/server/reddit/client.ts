import "server-only";
import { normalizeDestination as parseDestination, normalizePostingMinutes, normalizeFanvueUrl } from "@/lib/redditAutomation";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

export class RedditApiError extends Error {
  constructor(public code: string, public ambiguous = false, public retryAfterSeconds?: number) {
    super(code); this.name = "RedditApiError";
  }
}
export function redditApproved() { return process.env.REDDIT_API_APPROVED === "true"; }
export function redditRedirectUri() {
  const url = new URL(process.env.REDDIT_REDIRECT_URI || "https://sportaitipp.vercel.app/api/reddit/callback");
  if (url.protocol !== "https:" || url.pathname !== "/api/reddit/callback" || url.username || url.password || url.search || url.hash)
    throw new Error("REDDIT_REDIRECT_URI_INVALID");
  return url.toString();
}
export function redditConfigured() {
  try {
    redditRedirectUri();
    return Boolean(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET &&
      (process.env.REDDIT_TOKEN_ENCRYPTION_KEY?.length ?? 0) >= 32 && process.env.REDDIT_USER_AGENT?.trim());
  } catch { return false; }
}
function key() {
  const secret = process.env.REDDIT_TOKEN_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) throw new Error("REDDIT_TOKEN_ENCRYPTION_KEY_NOT_CONFIGURED");
  return createHash("sha256").update(secret).digest();
}
export function encrypt(value: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}
export function decrypt(value: string) {
  const data = Buffer.from(value, "base64url");
  if (data.length < 29) throw new Error("REDDIT_TOKEN_INVALID");
  const decipher = createDecipheriv("aes-256-gcm", key(), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
}
export function normalizeDestination(value: string): string | null {
  try { return parseDestination(value); } catch { return null; }
}
export function validPostingMinutes(values: number[]) {
  try { normalizePostingMinutes(values); return true; } catch { return false; }
}
export function validFanvueUrl(value: unknown): value is string {
  try { normalizeFanvueUrl(value); return true; } catch { return false; }
}
function headers(access?: string) {
  if (!redditApproved()) throw new RedditApiError("REDDIT_API_NOT_APPROVED");
  if (!redditConfigured()) throw new RedditApiError("REDDIT_APP_NOT_CONFIGURED");
  return { Authorization: access ? `Bearer ${access}` : `Basic ${Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`).toString("base64")}`,
    "User-Agent": process.env.REDDIT_USER_AGENT!, "Content-Type": "application/x-www-form-urlencoded" };
}
type RedditData = {
  id?: string; url?: string; display_name?: string; over18?: boolean; over_18?: boolean;
  submission_type?: string; subreddit_type?: string; quarantine?: boolean;
  title?: string; public_description?: string; description?: string;
  children?: Array<{ data: RedditData }>;
};
type RedditResponse = {
  error?: unknown; errors?: unknown[]; json?: { errors?: unknown[]; data?: RedditData };
  data?: RedditData; rules?: Array<{ short_name?: string; description?: string }>;
  access_token?: string; refresh_token?: string; expires_in?: number; id?: string; name?: string;
};
// A failed write may have succeeded remotely. Never retry automatically.
async function request(url: string, init: RequestInit, write = false): Promise<RedditResponse> {
  let response: Response;
  try { response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(25_000) }); }
  catch { throw new RedditApiError(write ? "REDDIT_SUBMIT_OUTCOME_UNKNOWN" : "REDDIT_NETWORK_ERROR", write); }
  if (!response.ok) {
    const wait = Number(response.headers.get("retry-after"));
    throw new RedditApiError(`REDDIT_HTTP_${response.status}`, write && (response.status >= 500 || response.status === 408),
      Number.isFinite(wait) && wait > 0 ? wait : undefined);
  }
  let body: RedditResponse;
  try { body = await response.json(); } catch { throw new RedditApiError("REDDIT_INVALID_RESPONSE", write); }
  if (!body || typeof body !== "object") throw new RedditApiError("REDDIT_INVALID_RESPONSE", write);
  if (body.error || (Array.isArray(body.errors) && body.errors.length) || (Array.isArray(body.json?.errors) && body.json.errors.length)) {
    const errors = body.json?.errors ?? body.errors;
    const code = Array.isArray(errors) ? String(Array.isArray(errors[0]) ? errors[0][0] : "REJECTED") : String(body.error);
    throw new RedditApiError(`REDDIT_${code.replace(/[^a-z0-9_]/gi, "_").slice(0, 80)}`);
  }
  return body;
}
type Token = { access_token: string; refresh_token?: string; expires_in: number };
async function token(params: Record<string, string>): Promise<Token> {
  const body = await request("https://www.reddit.com/api/v1/access_token", { method: "POST", headers: headers(), body: new URLSearchParams(params) });
  if (typeof body.access_token !== "string" || typeof body.expires_in !== "number" || body.expires_in <= 0) throw new RedditApiError("REDDIT_TOKEN_INVALID");
  return body as Token;
}
export function exchangeCode(code: string) { return token({ grant_type: "authorization_code", code, redirect_uri: redditRedirectUri() }); }
export function refreshToken(refresh: string) { return token({ grant_type: "refresh_token", refresh_token: refresh }); }
export async function redditIdentity(access: string) {
  const body = await request("https://oauth.reddit.com/api/v1/me", { headers: headers(access) });
  if (typeof body.id !== "string" || typeof body.name !== "string") throw new RedditApiError("REDDIT_IDENTITY_INVALID");
  return { id: body.id, username: body.name };
}
export async function redditSubreddit(access: string, destination: string) {
  const name = normalizeDestination(destination);
  if (!name) throw new RedditApiError("REDDIT_DESTINATION_INVALID");
  const [about, rules] = await Promise.all([
    request(`https://oauth.reddit.com/r/${name}/about`, { headers: headers(access) }),
    request(`https://oauth.reddit.com/r/${name}/about/rules`, { headers: headers(access) }),
  ]);
  if (!about.data || typeof about.data.display_name !== "string" || !Array.isArray(rules.rules)) throw new RedditApiError("REDDIT_SUBREDDIT_INVALID");
  return { name: about.data.display_name as string, title: about.data.title ?? "", description: [about.data.public_description, about.data.description].filter(Boolean).join("\n"), over18: Boolean(about.data.over18 ?? about.data.over_18),
    submissionType: String(about.data.submission_type ?? "any"), restricted: ["restricted", "private", "archived"].includes(about.data.subreddit_type ?? ""),
    quarantined: Boolean(about.data.quarantine), rules: rules.rules.map((r: { short_name?: string; description?: string }) => ({ name: r.short_name ?? "", description: r.description ?? "" })) };
}
export async function redditSubmitText(access: string, input: { subreddit: string; title: string; text: string; nsfw?: boolean; richtext?: string }) {
  const subreddit = normalizeDestination(input.subreddit);
  if (!subreddit || !input.title.trim() || input.title.length > 300 || !input.text.trim() || input.text.length > 40_000)
    throw new RedditApiError("REDDIT_POST_INVALID");
  const result = await request("https://oauth.reddit.com/api/submit", { method: "POST", headers: headers(access),
    body: new URLSearchParams({ api_type: "json", kind: "self", sr: subreddit, title: input.title, ...(input.richtext ? { richtext_json: input.richtext } : { text: input.text }),
      nsfw: input.nsfw ? "true" : "false", resubmit: "false", sendreplies: "false" }) }, true);
  const data = result.json?.data;
  if (typeof data?.id !== "string" || typeof data?.url !== "string") throw new RedditApiError("REDDIT_SUBMIT_OUTCOME_UNKNOWN", true);
  let url: URL;
  try { url = new URL(data.url, "https://www.reddit.com"); } catch { throw new RedditApiError("REDDIT_SUBMIT_OUTCOME_UNKNOWN", true); }
  if (url.protocol !== "https:" || !["reddit.com", "www.reddit.com"].includes(url.hostname)) throw new RedditApiError("REDDIT_SUBMIT_OUTCOME_UNKNOWN", true);
  return { id: data.id as string, permalink: url.toString() };
}

export async function redditSearchSubreddits(access: string, query: string, limit = 12) {
  const params = new URLSearchParams({ q: query.slice(0, 200), limit: String(Math.min(25, Math.max(1, Math.floor(limit)))), include_over_18: "true", raw_json: "1" });
  const body = await request(`https://oauth.reddit.com/subreddits/search?${params}`, { headers: headers(access) });
  if (!Array.isArray(body.data?.children)) throw new RedditApiError("REDDIT_SEARCH_INVALID");
  return body.data.children.filter(item => typeof item.data?.display_name === "string").map(({ data }) => ({
    name: data.display_name!, title: data.title ?? "", description: [data.public_description, data.description].filter(Boolean).join("\n"), over18: Boolean(data.over18 ?? data.over_18),
  }));
}
