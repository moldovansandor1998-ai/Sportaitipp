import { Estimate, JobType, NormalizedOutput, ProviderAdapter, ProviderError, SubmitParams, SubmitResult } from "./types";

const BASE = "https://developer.nureta.ai";
const endpoint = (image: boolean) => `${BASE}/api/v3/${image ? "images" : "contents"}/generations/tasks`;

export class NuretaAdapter implements ProviderAdapter {
  readonly name = "nureta";
  readonly supports: readonly JobType[] = ["nureta_scene_video"];

  async estimate(type: JobType, payload: Record<string, unknown>): Promise<Estimate> {
    if (type !== "nureta_scene_video") throw new ProviderError("Unsupported Nureta job", false);
    const duration = Number(payload.duration);
    // The existing WaveSpeed estimate uses roughly 300 credits/USD. Include a small margin.
    const rate = payload.resolution === "720p" ? 0.2773 : 0.1888;
    return { credits: Math.ceil(duration * rate * 330) + (payload.voiceMode === "model" ? 100 : 0), secondsExpected: 240 };
  }

  private async request(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
    const key = process.env.NURETA_API_KEY;
    if (!key) throw new ProviderError("NURETA_API_KEY hiányzik", false, undefined, "auth");
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...init?.headers },
        signal: AbortSignal.timeout(45_000),
      });
    } catch { throw new ProviderError("A Nureta API most nem érhető el.", true, undefined, "outage"); }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json"))
      throw new ProviderError("A Nureta API nem JSON választ adott; a feladat állapotát ellenőrizni kell.", false, undefined, "outage");
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new ProviderError(
      `Nureta ${response.status}: ${String(data.message ?? data.error ?? "provider error").slice(0, 180)}`,
      response.status === 429 || response.status >= 500,
      undefined, response.status === 401 ? "auth" : "invalid_input",
    );
    return data;
  }

  async submit(p: SubmitParams): Promise<SubmitResult> {
    const image = false;
    const refs = [p.payload.sceneImageUrl];
    if (!Array.isArray(refs) || !refs.length || refs.some((url) => typeof url !== "string" || !url.startsWith("https://")))
      throw new ProviderError("Hiányzik a jóváhagyott modellkép.", false, undefined, "invalid_input");
    const body = {
      model: p.payload.resolution === "720p" ? "seahorse-720p" : "seahorse-480p",
      duration: Number(p.payload.duration), ratio: "9:16",
      generate_audio: p.payload.voiceMode === "nureta",
      content: [{ type: "text", text: String(p.payload.prompt) },
        { type: "image_url", image_url: { url: refs[0] }, role: "first_frame" }],
    };
    // Polling is deliberate: no webhook secret, and never fall back to another paid provider.
    const result = await this.request(endpoint(image), { method: "POST", body: JSON.stringify(body) });
    if (typeof result.id !== "string") throw new ProviderError("Nureta feladatazonosító hiányzik.", false);
    return { providerJobId: result.id, providerMeta: { image } };
  }

  async getStatus(id: string, meta?: Record<string, unknown>): Promise<"running" | "done" | "failed"> {
    const result = await this.request(`${endpoint(meta?.image === true)}/${encodeURIComponent(id)}`);
    if (result.status === "succeeded") return "done";
    if (result.status === "failed" || result.status === "cancelled") {
      const error = result.error as { message?: string; code?: string } | string | undefined;
      const detail = typeof error === "string" ? error : error?.message ?? error?.code ?? String(result.status);
      throw new ProviderError(`Nureta: ${detail.slice(0, 250)}`, false, id, "invalid_input");
    }
    return "running";
  }

  async getResult(id: string, meta?: Record<string, unknown>): Promise<NormalizedOutput> {
    const image = meta?.image === true;
    const result = await this.request(`${endpoint(image)}/${encodeURIComponent(id)}`);
    if (result.status !== "succeeded") throw new ProviderError("A Nureta eredmény még nem készült el.", true);
    const content = result.content as Record<string, unknown> | undefined;
    const url = content?.[image ? "image_url" : "video_url"];
    if (typeof url !== "string" || !url.startsWith("https://")) throw new ProviderError("Nureta eredmény URL hiányzik.", false);
    console.info(JSON.stringify({ scope: "provider.output", provider: "nureta", providerJobId: id, outputHost: new URL(url).hostname }));
    return { files: [{ kind: image ? "image" : "video", url, filename: image ? "scene.jpg" : "video.mp4" }], meta: { provider: "nureta", outputHost: new URL(url).hostname } };
  }

  async cancel(): Promise<void> { /* Single-clip tasks cannot be cancelled through the API. */ }
  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; detail?: string }> {
    const start = Date.now();
    try { await this.request(`${BASE}/api/v3/models`); return { ok: true, latencyMs: Date.now() - start }; }
    catch (error) { return { ok: false, latencyMs: Date.now() - start, detail: String(error) }; }
  }
  normalizeWebhook(): { eventId: string; status: "failed" } { return { eventId: "unused", status: "failed" }; }
  async verifyWebhook(): Promise<boolean> { return false; }
}
