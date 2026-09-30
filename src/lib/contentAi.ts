import "server-only";

export class ContentAiNotConfiguredError extends Error {
  constructor() { super("CONTENT_AI_NOT_CONFIGURED"); }
}

export function contentAiConfigured(): boolean {
  return Boolean(openAiKey() || (process.env.CONTENT_AI_API_URL && process.env.CONTENT_AI_API_KEY && process.env.CONTENT_AI_MODEL));
}

function openAiKey(): string | undefined {
  // Temporary compatibility for a production secret saved with an extra trailing q.
  return process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEYq;
}

export async function generateContentJson<T>(system: string, prompt: string): Promise<T> {
  const customConfigured = Boolean(process.env.CONTENT_AI_API_URL && process.env.CONTENT_AI_API_KEY && process.env.CONTENT_AI_MODEL);
  const apiUrl = customConfigured ? process.env.CONTENT_AI_API_URL : "https://api.openai.com/v1/chat/completions";
  const apiKey = customConfigured ? process.env.CONTENT_AI_API_KEY : openAiKey();
  const model = customConfigured ? process.env.CONTENT_AI_MODEL : "gpt-5.6-luna";
  if (!apiUrl || !apiKey || !model) throw new ContentAiNotConfiguredError();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`CONTENT_AI_${response.status}`);
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error("CONTENT_AI_EMPTY_RESPONSE");
    return JSON.parse(content) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Write a short, image-grounded caption with a different angle from recent posts. */
export async function questionForXImage(jpeg: Buffer, modelName: string, slot: string,
  recentCaptions: string[] = [], angle = "playful observation"): Promise<{ question: string; hashtags: string[] }> {
  const key = openAiKey();
  if (!key) throw new ContentAiNotConfiguredError();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.CONTENT_VISION_MODEL || "gpt-5.6-luna",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Write ONE short, natural Hungarian X caption in the first person for an adult creator. Be lightly cheeky, witty and inviting, without explicit sexual content. Ground it in something clearly visible in the photo (setting, pose, mood, clothing, animal or activity), but do not repeatedly ask people to choose between garments or colors. Vary the form: some captions are playful statements, some invite an answer or a one-word comment, some ask a fresh easy question. A question mark is NOT required. Avoid generic daily check-ins, age guesses, invented events, locations, relationships, and anything not visible. Do not copy or closely paraphrase a recent caption, even from another model. No links, hashtags, or AI disclosure inside the caption. Return JSON with question (caption, 8–140 characters) and hashtags (zero to two common, relevant tags from: #selfie #outfit #divat #stilus #edzes #fitness #kutya #kave #termeszet #utazas #smink #haj #mosoly #hetkoznapok). Choose tags only for visible content; never claim a tag is trending." },
          { role: "user", content: [
            { type: "text", text: `Model: ${modelName}. Posting slot: ${slot}. Creative angle for this post: ${angle}. Recent captions to avoid in wording AND idea: ${JSON.stringify(recentCaptions.slice(0, 35))}. Keep the voice distinct for this model.` },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}`, detail: "low" } },
          ] },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`X_CAPTION_${response.status}`);
    const result = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(result.choices?.[0]?.message?.content ?? "{}") as { question?: unknown; hashtags?: unknown };
    const question = parsed.question;
    if (typeof question !== "string" || question.length < 8 || question.length > 140
      || /https?:\/\/|fanvue\.com|#[\p{L}\p{N}_]+/iu.test(question)) throw new Error("X_CAPTION_INVALID");
    const allowed = new Set(["#selfie", "#outfit", "#divat", "#stilus", "#edzes", "#fitness", "#kutya",
      "#kave", "#termeszet", "#utazas", "#smink", "#haj", "#mosoly", "#hetkoznapok"]);
    const hashtags = Array.isArray(parsed.hashtags) ? parsed.hashtags
      .filter((tag): tag is string => typeof tag === "string" && allowed.has(tag)).slice(0, 2) : [];
    return { question: question.trim(), hashtags: [...new Set(hashtags)] };
  } finally { clearTimeout(timer); }
}

/** Visually choose distinct scene photos from the owner's unused public pool. */
export async function choosePublicScenes(
  candidates: Array<{ id: string; url: string }>, count: number, story: string,
): Promise<string[]> {
  const key = openAiKey();
  if (!key) throw new ContentAiNotConfiguredError();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.CONTENT_VISION_MODEL || "gpt-5.6-luna",
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: `Choose ${count} different, fully clothed public TikTok scene photographs for a story carousel. Favor varied poses, clothing and locations, natural anatomy and realistic photography. Never invent IDs. Return JSON {"ids":["candidate UUID", ...]} in slide order.` },
          { role: "user", content: [
            { type: "text", text: `Story: ${story.slice(0, 650)}. Choose exactly ${count} of these candidate photos:` },
            ...candidates.flatMap((candidate, index) => [
              { type: "text", text: `Candidate ${index + 1}, id ${candidate.id}` },
              { type: "image_url", image_url: { url: candidate.url, detail: "low" } },
            ]),
          ] }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`CONTENT_VISION_${response.status}`);
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const ids = (JSON.parse(body.choices?.[0]?.message?.content ?? "{}") as { ids?: unknown }).ids;
    const allowed = new Set(candidates.map(c => c.id));
    if (!Array.isArray(ids) || ids.length !== count || ids.some(id => typeof id !== "string" || !allowed.has(id))
        || new Set(ids).size !== count) throw new Error("CONTENT_VISION_INVALID_SELECTION");
    return ids as string[];
  } finally { clearTimeout(timer); }
}
