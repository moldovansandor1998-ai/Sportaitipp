// Mock provider: kulcs nélkül, azonnal, determinisztikusan fut – célja a teljes
// folyamat (hold → job → kimenet → storage → galéria → charge → e-mail) tesztelése.
// A felületen egyértelműen "Mock motor (teszt)" néven szerepel, nem éles providerként.
import { createHash, createHmac, timingSafeEqual } from "crypto";
import type {
  Estimate, JobType, NormalizedOutput, ProviderAdapter, SubmitParams, SubmitResult,
} from "./types";

// A mock KIZÁRÓLAG a karakterfolyamat alaplépéseit és az alap kép/videó generálást szimulálja.
// Az alábbi jobtípusok NINCSENEK itt felsorolva – szándékosan: ezek BLOCKED állapotúak
// (nincs igazolt valódi adapterük), és a router a jelzésükre NO_PROVIDER_CONFIGURED/503-at ad,
// nem pedig hamis mock-sikert. Lásd FANNABE_PARITY_MATRIX.md.
const COST: Record<string, number> = {
  reference_qc: 5, character_training: 300, test_image: 10,
  image_generation: 20, image_edit: 20, video_from_image: 60, tts: 10,
};

function mockSvg(seed: string, label: string): string {
  const hue = parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 4), 16) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <rect width="1024" height="1024" fill="hsl(${hue},45%,18%)"/>
  <circle cx="512" cy="420" r="180" fill="hsl(${(hue + 40) % 360},55%,55%)"/>
  <text x="512" y="880" font-family="sans-serif" font-size="42" fill="#fff" text-anchor="middle">${label}</text>
</svg>`;
}

export class MockProvider implements ProviderAdapter {
  readonly name = "mock";
  readonly supports = Object.keys(COST) as JobType[];

  async estimate(jobType: JobType): Promise<Estimate> {
    return { credits: COST[jobType] ?? 10, secondsExpected: 1 };
  }

  async submit(p: SubmitParams): Promise<SubmitResult> {
    return { providerJobId: `mock_${p.idempotencyKey}`, providerMeta: { engine: "mock" } };
  }

  async getStatus(): Promise<"done"> { return "done"; }

  async getResult(providerJobId: string): Promise<NormalizedOutput> {
    const svg = mockSvg(providerJobId, "Castora mock kimenet");
    return {
      files: [{
        kind: "image", dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
        filename: "result.svg", contentType: "image/svg+xml",
      }],
      meta: { engine: "mock", note: "Tesztkimenet – éles provider nincs konfigurálva." },
    };
  }

  async cancel(): Promise<void> { /* nincs tartós mock-feladat */ }

  async healthCheck() { return { ok: true, latencyMs: 0 }; }

  normalizeWebhook(raw: unknown) {
    const r = raw as Record<string, unknown>;
    return { eventId: String(r?.eventId ?? "mock_evt"), providerJobId: r?.providerJobId as string | undefined, status: "done" as const };
  }

  async verifyWebhook(rawBody: string, headers: Record<string, string | null>, secret: string): Promise<boolean> {
    const sig = headers["x-cal-webhook-signature".replace("cal", "castora")] ?? headers["x-castora-signature"] ?? null;
    if (!sig) return false;
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    if (sig.length !== expected.length) return false;
    try { return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(sig, "utf8")); }
    catch { return false; }
  }
}
