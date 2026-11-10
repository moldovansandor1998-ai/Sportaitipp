import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { CookieOptions } from "@supabase/ssr";

const state = vi.hoisted(() => ({
  claims: null as null | { sub: string; email: string },
  banned: false,
  cookies: [] as Array<{ name: string; value: string; options: CookieOptions }>,
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn((_url, _key, options) => ({
    auth: { getClaims: async () => {
      options.cookies.setAll(state.cookies);
      return { data: state.claims ? { claims: state.claims } : null };
    } },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({
      data: { role: "user", banned_until: state.banned ? "2099-01-01T00:00:00Z" : null },
    }) }) }) }),
  })),
}));
import { updateSession } from "@/lib/supabase/middleware";

beforeEach(() => {
  state.claims = null;
  state.banned = false;
  state.cookies = [{ name: "sb-test-auth-token.0", value: "", options: {
    path: "/", maxAge: 0, sameSite: "lax", secure: true,
  } }];
});

describe("auth cookies on middleware responses", () => {
  it("clears stale cookies on the protected-page login redirect", async () => {
    const response = await updateSession(new NextRequest("https://example.com/tools"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://example.com/login?next=%2Ftools");
    expect(response.cookies.get(state.cookies[0].name)).toMatchObject({ value: "", maxAge: 0, path: "/", sameSite: "lax", secure: true });
  });

  it.each(["/login", "/register", "/admin"])("retains rotated cookie chunks on %s redirect", async (path) => {
    state.claims = { sub: "user-id", email: "customer@example.com" };
    state.cookies = [0, 1].map(index => ({ name: `sb-test-auth-token.${index}`, value: `new-${index}`, options: { path: "/", httpOnly: true, maxAge: 3600, sameSite: "lax" } }));
    const response = await updateSession(new NextRequest(`https://example.com${path}`));
    expect(response.headers.get("location")).toBe("https://example.com/dashboard");
    for (const cookie of state.cookies) expect(response.cookies.get(cookie.name)).toMatchObject({ name: cookie.name, value: cookie.value, ...cookie.options });
  });

  it.each(["/tools", "/api/gallery"])("preserves cookies on banned account response for %s", async (path) => {
    state.claims = { sub: "user-id", email: "customer@example.com" };
    state.banned = true;
    const response = await updateSession(new NextRequest(`https://example.com${path}`));
    expect(response.status).toBe(path.startsWith("/api/") ? 403 : 307);
    expect(response.cookies.get(state.cookies[0].name)?.maxAge).toBe(0);
    if (path.startsWith("/api/")) expect(await response.json()).toEqual({ error: "ACCOUNT_BANNED" });
    else expect(response.headers.get("location")).toBe("https://example.com/login?error=account_banned");
  });

  it("keeps cookies on the normal response", async () => {
    const response = await updateSession(new NextRequest("https://example.com/login"));
    expect(response.status).toBe(200);
    expect(response.cookies.get(state.cookies[0].name)?.maxAge).toBe(0);
  });
});
