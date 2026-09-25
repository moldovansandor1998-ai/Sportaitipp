// Adapter-tesztek a szolgáltatók valósághű response-fixture-öivel (fetch stub).
import { describe, it, expect, vi, afterEach } from "vitest";
import { FalAdapter } from "@/lib/providers/fal";
import { ReplicateAdapter } from "@/lib/providers/replicate";
import { Webhook } from "svix";

process.env.FAL_KEY = "test-fal-key";
process.env.REPLICATE_API_TOKEN = "test-rep-token";

function stubFetch(handler: (url: string, init?: RequestInit) => { status: number; body: unknown }): void {
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
    const r = handler(String(url), init);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }));
}
afterEach(() => vi.unstubAllGlobals());

const params = {
  jobId: "j1", jobType: "image_generation" as const, payload: { prompt: "portrait", loraPath: "lora/abc" },
  webhookUrl: "https://app/api/webhooks/provider/fal", idempotencyKey: "idem-1",
};

describe("fal.ai adapter (hivatalos Queue API)", () => {
  it("submit: endpoint + fal_webhook_url query + request_id/status/response URL", async () => {
    let seenUrl = "";
    stubFetch((url) => {
      seenUrl = url;
      return { status: 200, body: { request_id: "req_1", status_url: "https://queue.fal.run/fal-ai/flux-lora/requests/req_1/status", response_url: "https://queue.fal.run/fal-ai/flux-lora/requests/req_1" } };
    });
    const r = await new FalAdapter().submit(params);
    expect(seenUrl).toContain("https://queue.fal.run/fal-ai/flux-lora");
    expect(seenUrl).toContain("fal_webhook=");
    expect(r.providerJobId).toBe("req_1");
    expect(r.providerMeta?.statusUrl).toContain("/status");
    expect(r.providerMeta?.endpoint).toBe("fal-ai/flux-lora");
  });

  it("status: COMPLETED → done (meta-ból épített URL)", async () => {
    stubFetch((url) => {
      expect(url).toContain("requests/req_1/status");
      return { status: 200, body: { status: "COMPLETED" } };
    });
    const st = await new FalAdapter().getStatus("req_1", { endpoint: "fal-ai/flux-lora" });
    expect(st).toBe("done");
  });

  it("result: képek normalizálva", async () => {
    stubFetch(() => ({ status: 200, body: { images: [{ url: "https://fal.media/a.png" }], seed: 42 } }));
    const out = await new FalAdapter().getResult("req_1", { endpoint: "fal-ai/flux-lora" }, "image_generation");
    expect(out.files[0]).toMatchObject({ kind: "image", url: "https://fal.media/a.png" });
    expect(out.meta.seed).toBe(42);
  });

  it("failure: 429 retryable rate_limit, 401 non-retryable auth", async () => {
    stubFetch(() => ({ status: 429, body: {} }));
    await expect(new FalAdapter().submit(params)).rejects.toMatchObject({ retryable: true, category: "rate_limit" });
    vi.unstubAllGlobals();
    stubFetch(() => ({ status: 401, body: {} }));
    await expect(new FalAdapter().submit(params)).rejects.toMatchObject({ retryable: false, category: "auth" });
  });

  it("webhook: hivatalos Ed25519/JWKS verify – requestId\\nuserId\\ntimestamp\\nsha256hex, HEX aláírás", async () => {
    const { generateKeyPairSync, sign, createHash } = await import("crypto");
    const { FalAdapter } = await import("@/lib/providers/fal");
    const pair = generateKeyPairSync("ed25519");          // külön tesztkulcspár
    const jwk = pair.publicKey.export({ format: "jwk" }) as Record<string, unknown>;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL) => {
      if (String(url).includes(".well-known/jwks.json")) {
        return new Response(JSON.stringify({ keys: [{ ...jwk, use: "sig", kid: "t1" }] }), { status: 200 });
      }
      return origFetch(url as string);
    }) as typeof fetch;

    const a = new FalAdapter();
    const rawBody = JSON.stringify({ request_id: "req_9", status: "OK" });
    const tsNow = Math.floor(Date.now() / 1000);
    // HIVATALOS message: requestId\nuserId\ntimestamp\nsha256Hex(body); aláírás HEX
    const mkHeaders = (ts: number) => {
      const msg = ["req_9", "usr_1", String(ts), createHash("sha256").update(rawBody).digest("hex")].join("\n");
      return {
        "x-fal-webhook-request-id": "req_9",
        "x-fal-webhook-user-id": "usr_1",
        "x-fal-webhook-timestamp": String(ts),
        "x-fal-webhook-signature": sign(null, Buffer.from(msg), pair.privateKey).toString("hex"),
      };
    };
    expect(await a.verifyWebhook(rawBody, mkHeaders(tsNow))).toBe(true);           // érvényes
    expect(await a.verifyWebhook(rawBody, mkHeaders(tsNow - 600))).toBe(false);    // lejárt timestamp
    expect(await a.verifyWebhook(rawBody, { "x-fal-webhook-request-id": "req_9" })).toBe(false); // hiányzó headerek
    expect(a.normalizeWebhook(JSON.parse(rawBody)).eventId).toBe("req_9");
    globalThis.fetch = origFetch;
  });

  it("webhook payload: OK → done + kimenet a payload mezőből; ERROR → failed", async () => {
    const { FalAdapter } = await import("@/lib/providers/fal");
    const a = new FalAdapter();
    const ok = a.normalizeWebhook({
      request_id: "req_10", status: "OK",
      payload: { images: [{ url: "https://fal.media/w.png" }] },
    });
    expect(ok.status).toBe("done");
    expect(ok.output?.files[0].url).toBe("https://fal.media/w.png");
    const err = a.normalizeWebhook({ request_id: "req_11", status: "ERROR", payload: {} });
    expect(err.status).toBe("failed");
    expect(err.eventId).toBe("req_11");
  });

  it("submit tárolja a cancel_url-t; cancel azt használja", async () => {
    let cancelUrl = "";
    stubFetch((url, init) => {
      if (init?.method === "PUT") { cancelUrl = String(url); return { status: 200, body: {} }; }
      return { status: 200, body: {
        request_id: "req_c",
        status_url: "https://queue.fal.run/fal-ai/flux-lora/requests/req_c/status",
        response_url: "https://queue.fal.run/fal-ai/flux-lora/requests/req_c",
        cancel_url: "https://queue.fal.run/fal-ai/flux-lora/requests/req_c/cancel",
      } };
    });
    const a = new FalAdapter();
    const r = await a.submit(params);
    expect(r.providerMeta?.cancelUrl).toContain("/cancel");
    await a.cancel("req_c", r.providerMeta);
    expect(cancelUrl).toContain("/cancel");
  });

  it("getStatus: IN_PROGRESS → running", async () => {
    stubFetch(() => ({ status: 200, body: { status: "IN_PROGRESS" } }));
    expect(await new FalAdapter().getStatus("req_1", { endpoint: "fal-ai/flux-lora" })).toBe("running");
  });

  it("hiányzó provider_meta → érthető hiba (nem csendes fallthrough)", async () => {
    stubFetch(() => ({ status: 200, body: {} }));
    await expect(new FalAdapter().getStatus("req_x", undefined)).rejects.toThrow(/provider_meta/);
  });
});

describe("Replicate adapter (dokumentált REST)", () => {
  const rep = () => new ReplicateAdapter();

  it("prediction submit + status/result + cancel", async () => {
    const calls: string[] = [];
    stubFetch((url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("/predictions") && init?.method === "POST") {
        return { status: 201, body: { id: "pred_1", status: "starting" } };
      }
      if (url.endsWith("/cancel")) return { status: 200, body: {} };
      return { status: 200, body: { status: "succeeded", output: ["https://replicate.delivery/img.png"], logs: "ok" } };
    });
    const r = await rep().submit(params);
    expect(r.providerJobId).toBe("pred_1");
    expect(await rep().getStatus("pred_1", { kind: "prediction" })).toBe("done");
    const out = await rep().getResult("pred_1", { kind: "prediction" });
    expect(out.files[0].url).toContain("replicate.delivery");
    await rep().cancel("pred_1", { kind: "prediction" });
    expect(calls.some((c) => c.includes("POST") && c.includes("/cancel"))).toBe(true);
  });

  it("training: hivatalos training flow (nem prediction)", async () => {
    let seenBody = "";
    stubFetch((url, init) => {
      seenBody = String(init?.body ?? "");
      expect(url).toContain("/models/ostris/flux-dev-lora-trainer/trainings");
      return { status: 201, body: { id: "train_1", status: "training", version: "v9" } };
    });
    const r = await rep().submit({
      ...params, jobType: "character_training",
      webhookUrl: "https://app/api/webhooks/provider/replicate",
      payload: { imagesDataUrl: "data:application/zip;base64,AAA", destination: "me/my-lora" },
    });
    expect(r.providerJobId).toBe("train_1");
    expect(JSON.parse(seenBody).destination).toBe("me/my-lora");
    expect(JSON.parse(seenBody).webhook).toContain("/webhooks/provider/replicate");
  });

  it("training result: weights meta, nincs fájl", async () => {
    stubFetch(() => ({ status: 200, body: { status: "succeeded", output: "https://weights.replicate/...", version: "v9" } }));
    const out = await rep().getResult("train_1", { kind: "training" });
    expect(out.files).toHaveLength(0);
    expect(String(out.meta.weights)).toContain("weights");
  });

  it("webhook: Standard Webhooks (svix), timestamp-ablakkal", async () => {
    const secret = "whsec_test";
    const wh = new Webhook(secret);
    const payload = JSON.stringify({ id: "pred_7", status: "succeeded" });
    const tsNow = Math.floor(Date.now() / 1000);
    const sign = (id: string, ts: number): Record<string, string> => ({
      "webhook-id": id,
      "webhook-timestamp": String(ts),
      "webhook-signature": wh.sign(id, new Date(ts * 1000), payload),
    });
    const headers = sign("msg_1", tsNow);
    expect(await rep().verifyWebhook(payload, headers, secret)).toBe(true);
    // hamis aláírás
    expect(await rep().verifyWebhook(payload, { ...headers, "webhook-signature": "v1,forged" }, secret)).toBe(false);
    // lejárt timestamp (>5 perc) – a verify elutasítja
    expect(await rep().verifyWebhook(payload, sign("msg_2", tsNow - 600), secret)).toBe(false);
  });

  it("hibatípusok: 422 invalid_input non-retryable, 500 outage retryable", async () => {
    stubFetch(() => ({ status: 422, body: {} }));
    await expect(rep().submit(params)).rejects.toMatchObject({ retryable: false, category: "invalid_input" });
    vi.unstubAllGlobals();
    stubFetch(() => ({ status: 500, body: {} }));
    await expect(rep().submit(params)).rejects.toMatchObject({ retryable: true, category: "outage" });
  });
});

describe("production fail-closed (mock tilos)", () => {
  it("productionben kulcs mellett sincs mock (fal elérhető, mock nincs)", async () => {
    const env = process.env as Record<string, string | undefined>;
    const saved = { node: env.NODE_ENV, allow: env.PROVIDER_ALLOW_MOCK_PRODUCTION };
    Object.assign(process.env, { NODE_ENV: "production" });
    delete env.PROVIDER_ALLOW_MOCK_PRODUCTION;
    const { buildRouter } = await import("@/lib/providers");
    const router = buildRouter();
    const names = router.candidates("image_generation").map((a) => a.name);
    expect(names).toContain("fal");
    expect(names).not.toContain("mock");
    Object.assign(process.env, { NODE_ENV: saved.node });
    if (saved.allow === undefined) delete env.PROVIDER_ALLOW_MOCK_PRODUCTION; else env.PROVIDER_ALLOW_MOCK_PRODUCTION = saved.allow;
  });

  it("kulcsok nélkül productionben nincs elérhető adapter", async () => {
    const saved = { fal: process.env.FAL_KEY, rep: process.env.REPLICATE_API_TOKEN, node: process.env.NODE_ENV, allow: process.env.PROVIDER_ALLOW_MOCK };
    delete process.env.FAL_KEY; delete process.env.REPLICATE_API_TOKEN; delete process.env.PROVIDER_ALLOW_MOCK;
    Object.assign(process.env, { NODE_ENV: "production" });
    const { buildRouter } = await import("@/lib/providers");
    const router = buildRouter();
    expect(router.candidates("image_generation")).toHaveLength(0);
    process.env.FAL_KEY = saved.fal; process.env.REPLICATE_API_TOKEN = saved.rep;
    Object.assign(process.env, { NODE_ENV: saved.node }); process.env.PROVIDER_ALLOW_MOCK = saved.allow;
  });
});
