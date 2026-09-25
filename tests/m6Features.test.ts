// M6 funkciók célzott tesztjei – TÉNYLEGES adapter-payloadok, route-hibautak, jogosultságok.
// Minden hálózat mockolva (fetch-stub); nincs külső kérés.
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";

const SAVED_ENV: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NODE_ENV"]) SAVED_ENV[k] = process.env[k];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://stub";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
});
afterAll(() => {
  for (const [k, v] of Object.entries(SAVED_ENV)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});
afterEach(() => vi.unstubAllGlobals());

vi.mock("@/server/jobs/schedule", () => ({ scheduleKick: () => {} }));

describe("fal.ai adapter – M6 eszközök leképezése", () => {
  function captureSubmit(jobType: string, payload: Record<string, unknown>): Promise<{ sent: Record<string, unknown>; url: string }> {
    return new Promise((resolve) => {
      vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
        resolve({ sent: JSON.parse(String(init?.body)) as Record<string, unknown>, url: String(url) });
        return new Response(JSON.stringify({ request_id: "r" }), { status: 200 });
      }));
      process.env.FAL_KEY = "k";
      void import("@/lib/providers/fal").then(async (m) => {
        await new m.FalAdapter().submit({
          jobId: "j", jobType: jobType as never, payload,
          webhookUrl: "https://app/hook", idempotencyKey: "k1",
        });
      });
    });
  }
  it("Image-to-Prompt → caption végpont", async () => {
    const { sent, url } = await captureSubmit("video_to_prompt", { imageUrl: "https://fal.media/a.png" });
    expect(url).toContain("fal-ai/imageutils/caption");
    expect(sent).toMatchObject({ image_url: "https://fal.media/a.png" });
  });
  it("Upscale → esrgan, scale átadva", async () => {
    const { sent, url } = await captureSubmit("upscale", { imageUrl: "https://fal.media/a.png", scale: 4 });
    expect(url).toContain("fal-ai/esrgan");
    expect(sent).toMatchObject({ scale: 4 });
  });
  it("Background Removal → birefnet", async () => {
    const { url } = await captureSubmit("background_removal", { imageUrl: "https://fal.media/a.png" });
    expect(url).toContain("fal-ai/birefnet");
  });
  it("Character Swap → face-swap, base+swap URL", async () => {
    const { sent, url } = await captureSubmit("character_swap", { imageUrl: "https://fal.media/base.png", swapImageUrl: "https://fal.media/swap.png" });
    expect(url).toContain("fal-ai/face-swap");
    expect(sent).toMatchObject({ base_image_url: "https://fal.media/base.png", swap_image_url: "https://fal.media/swap.png" });
  });
  it("Talking/Lip-sync → sync-lips, video+audio", async () => {
    const { sent } = await captureSubmit("talking_video", { videoUrl: "https://fal.media/v.mp4", audioUrl: "https://fal.media/a.mp3" });
    expect(sent).toMatchObject({ video_url: "https://fal.media/v.mp4", audio_url: "https://fal.media/a.mp3" });
  });
  it("Video-to-Video → kling v2v", async () => {
    const { sent, url } = await captureSubmit("video_to_video", { videoUrl: "https://fal.media/v.mp4", prompt: "stílus" });
    expect(url).toContain("kling-video/v2.1/master/video-to-video");
    expect(sent).toMatchObject({ video_url: "https://fal.media/v.mp4" });
  });
  it("Skin/FixFace → nano-banana edit, SZERVER preset prompt", async () => {
    const { sent, url } = await captureSubmit("skin_enhance", { imageUrl: "https://fal.media/a.png", prompt: "SERVER-PRESET" });
    expect(url).toContain("nano-banana-pro/edit");
    expect(sent).toMatchObject({ prompt: "SERVER-PRESET", image_urls: ["https://fal.media/a.png"] });
  });
});

const USER = "11111111-1111-1111-1111-111111111111";
function harness(opts: { asset?: unknown }): { calls: { rpc: string[] } } {
  const calls = { rpc: [] as string[] };
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
    const u = String(url);
    if (u.includes("/auth/v1/user")) return new Response(JSON.stringify({ user: { id: USER } }), { status: 200 });
    if (u.includes("/rest/v1/profiles")) return new Response(JSON.stringify({ id: USER, age_verified_at: "2024-01-01T00:00:00Z" }), { status: 200 });
    if (u.includes("/rest/v1/assets")) return new Response(JSON.stringify(opts.asset ?? null), { status: 200 });
    if (u.includes("/storage/v1")) return new Response(JSON.stringify({ signedURL: "/object/sign/assets/x?token=t" }), { status: 200 });
    if (u.includes("/rest/v1/rpc/")) {
      const fn = u.split("/rpc/")[1].split("?")[0];
      calls.rpc.push(fn);
      if (fn === "create_job_with_hold") return new Response(JSON.stringify("job-1"), { status: 200 });
      return new Response("true", { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }));
  return { calls };
}
async function postJobs(body: Record<string, unknown>): Promise<Response> {
  const { POST } = await import("@/app/api/jobs/route");
  return POST(new NextRequest("http://localhost/api/jobs", {
    method: "POST", headers: { authorization: "Bearer t", "content-type": "application/json" }, body: JSON.stringify(body),
  }));
}

describe("/api/jobs – M6 bemenet-feloldás és hibautak", () => {
  it("hiányzó asset (upscale) → 400, NINCS create", async () => {
    const { calls } = harness({ asset: null });
    const res = await postJobs({ type: "upscale", payload: { sourceAssetId: "33333333-3333-3333-3333-333333333333" } });
    expect(res.status).toBe(400);
    expect(calls.rpc).not.toContain("create_job_with_hold");
  });
  it("tiltott külső URL (SSRF) → 400 URL_NOT_ALLOWED", async () => {
    harness({ asset: null });
    const res = await postJobs({ type: "upscale", payload: { imageUrl: "http://169.254.169.254/latest/meta-data" } });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe("URL_NOT_ALLOWED");
  });
  it("saját asset (upscale) → 202, create_job_with_hold megy", async () => {
    const { calls } = harness({ asset: { id: "a1", bucket: "assets", object_path: "u/a.png" } });
    const res = await postJobs({ type: "upscale", payload: { sourceAssetId: "33333333-3333-3333-3333-333333333333" } });
    expect(res.status).toBe(202);
    expect(calls.rpc).toContain("create_job_with_hold");
  });
  it("provider nélkül productionben → 503 NO_PROVIDER_CONFIGURED", async () => {
    delete process.env.FAL_KEY; delete process.env.REPLICATE_API_TOKEN;
    Object.assign(process.env, { NODE_ENV: "production" });
    harness({ asset: { id: "a1", bucket: "assets", object_path: "u/a.png" } });
    const res = await postJobs({ type: "upscale", payload: { sourceAssetId: "33333333-3333-3333-3333-333333333333" } });
    expect(res.status).toBe(503);
    expect((await res.json() as { error: string }).error).toBe("NO_PROVIDER_CONFIGURED");
  });
  it("talking_video: hiányzó hang → 400", async () => {
    harness({ asset: { id: "v1", bucket: "assets", object_path: "u/v.mp4" } });
    const res = await postJobs({ type: "talking_video", payload: { videoAssetId: "33333333-3333-3333-3333-333333333333" } });
    expect(res.status).toBe(400);
  });
  it("skin_enhance: sikeres út", async () => {
    const { calls } = harness({ asset: { id: "a1", bucket: "assets", object_path: "u/a.png" } });
    process.env.FAL_KEY = "k"; Object.assign(process.env, { NODE_ENV: "test" });
    const res = await postJobs({ type: "skin_enhance", payload: { sourceAssetId: "33333333-3333-3333-3333-333333333333" } });
    expect(res.status).toBe(202);
    expect(calls.rpc).toContain("create_job_with_hold");
  });
});

describe("/api/albums – CRUD + tulajdon", () => {
  function alb(opts: { user?: string | null; tokenValid?: boolean }): void {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/auth/v1/user")) {
        if (opts.tokenValid === false || !opts.user) {
          return new Response(JSON.stringify({ code: "bad_jwt", message: "JWT is missing" }),
            { status: 401, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({ user: { id: opts.user } }), { status: 200 });
      }
      if (u.includes("/rest/v1/albums")) {
        if ((init?.method ?? "GET") === "POST") return new Response(JSON.stringify({ id: "al-1", name: "Teszt" }), { status: 201 });
        return new Response(JSON.stringify(opts.user === USER ? [{ id: "al-1", name: "Enyém" }] : []), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }));
  }
  it("nincs Authorization fejléc → 401 (GET és POST is)", async () => {
    alb({ user: null, tokenValid: false });
    const { GET, POST } = await import("@/app/api/albums/route");
    expect((await GET(new NextRequest("http://x/api/albums", { headers: {} }))).status).toBe(401);
    expect((await POST(new NextRequest("http://x/api/albums", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "T" }) }))).status).toBe(401);
  });
  it("hibás Bearer token → 401", async () => {
    alb({ user: null, tokenValid: false });
    const { GET } = await import("@/app/api/albums/route");
    expect((await GET(new NextRequest("http://x/api/albums", { headers: { authorization: "Bearer rossz-token" } }))).status).toBe(401);
  });
  it("érvényes token → 201/200; MÁS felhasználó nem látja az enyémet", async () => {
    alb({ user: USER, tokenValid: true });
    const { GET, POST } = await import("@/app/api/albums/route");
    const t = { authorization: "Bearer t", "content-type": "application/json" };
    expect((await POST(new NextRequest("http://x/api/albums", { method: "POST", headers: t, body: JSON.stringify({ name: "Teszt" }) }))).status).toBe(201);
    const g = await GET(new NextRequest("http://x/api/albums", { headers: t }));
    expect(((await g.json()) as { albums: unknown[] }).albums).toHaveLength(1);
    alb({ user: "99999999-9999-4999-9999-999999999999", tokenValid: true });
    const g2 = await GET(new NextRequest("http://x/api/albums", { headers: { authorization: "Bearer masik" } }));
    expect(((await g2.json()) as { albums: unknown[] }).albums).toHaveLength(0);
  });
});

describe("/api/calendar – CRUD + validáció", () => {
  it("201 érvényes bodyval; 400 érvénytelen platformmal", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/auth/v1/user")) return new Response(JSON.stringify({ user: { id: USER } }), { status: 200 });
      if (u.includes("/rest/v1/content_calendar_posts")) {
        if ((init?.method ?? "GET") === "POST") return new Response(JSON.stringify({ id: "c1" }), { status: 201 });
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }));
    const { POST } = await import("@/app/api/calendar/route");
    const t = { authorization: "Bearer t", "content-type": "application/json" };
    const ok = await POST(new NextRequest("http://x/api/calendar", { method: "POST", headers: t,
      body: JSON.stringify({ platform: "tiktok", body: "szia", mediaAssetId: null, scheduledAt: new Date().toISOString() }) }));
    expect(ok.status).toBe(201);
    const bad = await POST(new NextRequest("http://x/api/calendar", { method: "POST", headers: t,
      body: JSON.stringify({ platform: "nem-platform", body: "", mediaAssetId: null, scheduledAt: "2026-01-01" }) }));
    expect(bad.status).toBe(400);
  });
});

describe("/api/admin/summary – csak admin", () => {
  it("nem admin → 403", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/auth/v1/user")) return new Response(JSON.stringify({ user: { id: USER } }), { status: 200 });
      if (u.includes("/rest/v1/profiles")) return new Response(JSON.stringify({ id: USER, role: "user" }), { status: 200 });
      return new Response("{}", { status: 200 });
    }));
    const { GET } = await import("@/app/api/admin/summary/route");
    expect((await GET(new NextRequest("http://x/api/admin/summary", { headers: { authorization: "Bearer t" } }))).status).toBe(403);
  });
});

describe("sniffMedia – MP3/WAV", () => {
  it("MP3 ID3 és frame, WAV RIFF felismerés", async () => {
    const { sniffMedia } = await import("@/lib/trainingDataset");
    expect(sniffMedia(Buffer.from([0x49, 0x44, 0x33, 3, 0]))).toBe("audio/mpeg");
    expect(sniffMedia(Buffer.from([0xff, 0xfb, 0x90, 0x00]))).toBe("audio/mpeg");
    expect(sniffMedia(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE")]))).toBe("audio/wav");
    expect(sniffMedia(Buffer.from("nope"))).toBeNull();
  });
});
