/** Pure validation shared by the scheduler and authenticated settings routes. */
export function normalizeFanvueUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("REDDIT_FANVUE_LINK_REQUIRED");
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("REDDIT_FANVUE_LINK_REQUIRED"); }
  if (url.protocol !== "https:" || !["fanvue.com", "www.fanvue.com"].includes(url.hostname)
    || url.username || url.password || url.port || !/^\/[A-Za-z0-9._-]+\/?$/.test(url.pathname))
    throw new Error("REDDIT_FANVUE_LINK_REQUIRED");
  url.hash = "";
  return url.toString();
}

export function normalizeDestination(value: string): string {
  const normalized = value.trim().replace(/^\/?r\//i, "").replace(/^\/?u\//i, "u_");
  if (!/^(?:[A-Za-z0-9_]{3,21}|u_[A-Za-z0-9_-]{3,20})$/.test(normalized))
    throw new Error("REDDIT_INVALID_DESTINATION");
  return normalized.toLowerCase();
}

export function normalizePostingMinutes(value: number[]): number[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4
    || value.some(minute => !Number.isInteger(minute) || minute < 0 || minute > 1439))
    throw new Error("REDDIT_INVALID_SCHEDULE");
  const sorted = [...value].sort((a, b) => a - b);
  if (new Set(sorted).size !== sorted.length || (sorted.length > 1 && sorted.some((minute, index) =>
    ((sorted[(index + 1) % sorted.length] - minute + 1440) % 1440) < 120)))
    throw new Error("REDDIT_SCHEDULE_TOO_CLOSE");
  return sorted;
}

export function localRedditTime(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (key: string) => parts.find(item => item.type === key)?.value ?? "";
  return { date: `${part("year")}-${part("month")}-${part("day")}`,
    minute: Number(part("hour")) * 60 + Number(part("minute")) };
}

const words = (value: string) => new Set(value.toLocaleLowerCase("hu-HU").normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(word => word.length > 3));

export function redditCopyTooSimilar(candidate: string, previous: string[]): boolean {
  const normalized = candidate.toLocaleLowerCase("hu-HU").replace(/[^\p{L}\p{N}]/gu, "");
  const candidateWords = words(candidate);
  return previous.some(value => {
    if (value.toLocaleLowerCase("hu-HU").replace(/[^\p{L}\p{N}]/gu, "") === normalized) return true;
    const other = words(value);
    const overlap = [...candidateWords].filter(word => other.has(word)).length;
    return overlap >= 3 && overlap / Math.min(candidateWords.size || 1, other.size || 1) >= 0.65;
  });
}

export function buildRedditCopy(caption: string, modelName: string, fanvueUrl: string) {
  const title = caption.trim();
  if (title.length < 8 || title.length > 180 || /https?:\/\/|[\r\n]|#[\p{L}\p{N}_]+/iu.test(title))
    throw new Error("REDDIT_INVALID_CAPTION");
  const name = modelName.replace(/[\r\n]/g, " ").trim().slice(0, 80);
  const url = normalizeFanvueUrl(fanvueUrl);
  return { title, text: `${title}\n\n${name} · AI-karakter, AI-val készített kép.\n\nItt találsz meg: ${url}` };
}
