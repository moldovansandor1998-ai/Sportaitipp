import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const saved: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) saved[key] = process.env[key];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://stub";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
});
afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
afterEach(() => vi.unstubAllGlobals());

describe("reference upload authentication", () => {
  it("passes the Bearer token to Supabase Auth before signing the upload", async () => {
    const authHeaders: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/auth/v1/user")) {
        authHeaders.push(new Headers(init?.headers).get("authorization") ?? "");
        return new Response(JSON.stringify({ id: "11111111-1111-4111-8111-111111111111" }), { status: 200 });
      }
      if (url.includes("/storage/v1/object/upload/sign/references/")) {
        return new Response(JSON.stringify({ url: "/object/upload/sign/references/example?token=signed", token: "signed" }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));
    const { POST } = await import("@/app/api/uploads/sign/route");
    const res = await POST(new NextRequest("http://localhost/api/uploads/sign", {
      method: "POST", headers: { authorization: "Bearer valid-token" },
      body: JSON.stringify({ filename: "portrait.jpg", kind: "face" }),
    }));
    expect(res.status).toBe(200);
    expect(authHeaders).toEqual(["Bearer valid-token"]);
    expect((await res.json()).token).toBe("signed");
  });
});
