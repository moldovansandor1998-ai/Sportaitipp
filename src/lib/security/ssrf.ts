// SSRF-védelem: csak engedélyezett hostokról engedünk letölteni kimenetet.
const ALLOWED_HOSTS = new Set<string>();
// LAZY own-host: később beállított env és hiányzó konfig esetén is helyes (zárt, https-only, pontos host)
function ownStorageHost(): string | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return null;
    return u.hostname.toLowerCase();
  } catch { return null; }
}

if (process.env.NEXT_PUBLIC_ASSET_HOST) ALLOWED_HOSTS.add(process.env.NEXT_PUBLIC_ASSET_HOST);

// Provider-eredmények letöltési hostjai (egyedi felsorolás, nincs wildcard):
ALLOWED_HOSTS.add("storage.googleapis.com"); // Replicate artefaktok
ALLOWED_HOSTS.add("fal.media");              // fal.ai eredmények
ALLOWED_HOSTS.add("v2.fal.media");
ALLOWED_HOSTS.add("v3.fal.media");
ALLOWED_HOSTS.add("v3b.fal.media");          // fal.ai FLUX LoRA képkimenet
ALLOWED_HOSTS.add("replicate.delivery");
ALLOWED_HOSTS.add("cdn.wavespeed.ai");      // WaveSpeed arccsere-kimenetek
ALLOWED_HOSTS.add("d2h7xmz5gqybh9.cloudfront.net"); // WaveSpeed tényleges képkimenet

export function assertAllowedUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("URL_SCHEME_NOT_ALLOWED");
  if (url.username || url.password) throw new Error("URL_CREDENTIALS_NOT_ALLOWED");
  const host = url.hostname.toLowerCase();
  // Privát/link-local tartományok tiltása mindenképp
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1)/.test(host)) {
    throw new Error("URL_HOST_NOT_ALLOWED");
  }
  const own = ownStorageHost();
  if (own && url.origin === "https://" + own) return url;
  if (ALLOWED_HOSTS.size > 0 && ALLOWED_HOSTS.has(host)) {
    if (url.protocol !== "https:") throw new Error("URL_SCHEME_NOT_ALLOWED");
    return url;
  }
  throw new Error("URL_HOST_NOT_ALLOWED");
}
