import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { middleware } from "@/middleware";
import { PUBLIC_LOCALE_HEADER } from "@/lib/public-locale";
import { SOCIAL_IMAGE_PATH } from "@/lib/seo";

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims: async () => ({ data: null }) } }),
}));

describe("public crawler middleware", () => {
  it.each(["/", "/en", "/hu", "/ro", "/it", "/de", "/fr", "/sk", "/pl", "/robots.txt", "/sitemap.xml", "/icon.svg", SOCIAL_IMAGE_PATH,
    ...["image-generation", "video-motion", "voice-talking-video", "content-planning", "creative-library"].map(name => `/images/feature-photos/${name}.png`),
  ])("keeps %s public for anonymous crawlers", async (path) => {
    const request = new NextRequest("https://startaicreator.com" + path);
    const response = await middleware(request);
    expect(response.status).toBe(200);
    expect(response.headers.has("location")).toBe(false);
    expect(response.headers.has("X-Robots-Tag")).toBe(false);
    expect(response.headers.get("Cache-Control") ?? "").not.toMatch(/private|no-store/);
  });

  it.each(["/login", "/register", "/hu/not-public", "/images/social/private.txt", "/api/projects", "/generate"])("retains private indexing/cache headers on %s", async (path) => {
    const response = await middleware(new NextRequest("https://startaicreator.com" + path));
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow, noarchive");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
  });

  it.each(["/dashboard", "/characters", "/gallery", "/jobs", "/settings", "/calendar", "/tools", "/content", "/projects", "/plans", "/admin"])("preserves anonymous auth protection on %s", async (path) => {
    const response = await middleware(new NextRequest("https://startaicreator.com" + path));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://startaicreator.com/login?next=" + encodeURIComponent(path));
    expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
  });

  it.each([["/", "en"], ["/en", "en"], ["/hu", "hu"], ["/ro", "ro"], ["/it", "it"], ["/de", "de"], ["/fr", "fr"], ["/sk", "sk"], ["/pl", "pl"], ["/login", "en"]])("forwards trusted locale for %s rather than caller input", async (path, expected) => {
    const request = new NextRequest("https://startaicreator.com" + path, { headers: { [PUBLIC_LOCALE_HEADER]: expected === "en" ? "hu" : "en" } });
    const response = await middleware(request);
    expect(request.headers.get(PUBLIC_LOCALE_HEADER)).toBe(expected);
    expect(response.headers.get("x-middleware-request-" + PUBLIC_LOCALE_HEADER)).toBe(expected);
  });
  it.each([
    ["/ro", "de", "ro"], ["/", "fr", "en"], ["/en", "pl", "en"],
    ["/login", "ro", "ro"], ["/privacy", "de", "hu"], ["/settings", "pl", "pl"],
    ["/login", "invalid", "en"],
  ])("uses explicit public URL before a validated preference on %s", async (path, cookie, expected) => {
    const request = new NextRequest("https://startaicreator.com" + path, { headers: { cookie: `start-ai-locale=${cookie}`, [PUBLIC_LOCALE_HEADER]: "fr" } });
    await middleware(request);
    expect(request.headers.get(PUBLIC_LOCALE_HEADER)).toBe(expected);
  });

});
