import "server-only";

export class ContentAiNotConfiguredError extends Error {
  constructor() { super("CONTENT_AI_NOT_CONFIGURED"); }
}

export function contentAiConfigured(): boolean {
  return Boolean(process.env.CONTENT_AI_API_URL && process.env.CONTENT_AI_API_KEY && process.env.CONTENT_AI_MODEL);
}

export async function generateContentJson<T>(system: string, prompt: string): Promise<T> {
  const apiUrl = process.env.CONTENT_AI_API_URL;
  const apiKey = process.env.CONTENT_AI_API_KEY;
  const model = process.env.CONTENT_AI_MODEL;
  if (!apiUrl || !apiKey || !model) throw new ContentAiNotConfiguredError();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.7,
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
