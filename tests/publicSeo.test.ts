import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { landingContent } from "@/components/marketing/content";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { documentLocale } from "@/lib/public-locale";
import { landingMetadata, SITE_ORIGIN, siteOrigin, SOCIAL_IMAGE_PATH, SOCIAL_IMAGE_WIDTH, SOCIAL_IMAGE_HEIGHT } from "@/lib/seo";

afterEach(() => vi.unstubAllEnvs());

describe("international public SEO", () => {
  it.each(["en", "hu"] as const)("publishes complete %s social preview metadata", (locale) => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE_ORIGIN);
    const metadata = landingMetadata(locale);
    const path = locale === "en" ? "/" : "/hu";
    expect(metadata.alternates).toEqual({
      canonical: SITE_ORIGIN + path,
      languages: { en: SITE_ORIGIN + "/", hu: SITE_ORIGIN + "/hu", "x-default": SITE_ORIGIN + "/" },
    });
    expect(metadata.openGraph).toMatchObject({
      type: "website", url: SITE_ORIGIN + path, siteName: "Start AI Creator",
      locale: locale === "en" ? "en_US" : "hu_HU",
      images: [{ url: SITE_ORIGIN + SOCIAL_IMAGE_PATH, width: 1200, height: 630, type: "image/jpeg", alt: expect.any(String) }],
    });
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image", images: [{ url: SITE_ORIGIN + SOCIAL_IMAGE_PATH, alt: expect.any(String) }] });
    expect(metadata.robots).toMatchObject({ index: true, follow: true });
    expect(metadata.description).not.toMatch(/guaranteed|unlimited|free|revenue/i);
  });

  it("ships the real public social image with matching dimensions and format", async () => {
    const path = resolve("public" + SOCIAL_IMAGE_PATH);
    const image = await sharp(await readFile(path)).metadata();
    expect(image).toMatchObject({ format: "jpeg", width: SOCIAL_IMAGE_WIDTH, height: SOCIAL_IMAGE_HEIGHT });
    expect((await stat(path)).size).toBeLessThan(1_000_000);
  });

  it("lists only canonical landing pages, with reciprocal international alternates", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE_ORIGIN);
    const entries = sitemap();
    expect(entries.map(entry => entry.url)).toEqual([SITE_ORIGIN + "/", SITE_ORIGIN + "/hu"]);
    for (const entry of entries) {
      expect(entry.alternates?.languages).toEqual({ en: SITE_ORIGIN + "/", hu: SITE_ORIGIN + "/hu", "x-default": SITE_ORIGIN + "/" });
    }
    expect(robots()).toEqual({ rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/auth/"] }, sitemap: SITE_ORIGIN + "/sitemap.xml" });
  });

  it("uses canonical language links and leaves internal document languages unchanged", () => {
    expect(landingContent.en.languageHref).toBe("/hu");
    expect(landingContent.hu.languageHref).toBe("/");
    expect(documentLocale("/")).toBe("en");
    expect(documentLocale("/en")).toBe("en");
    for (const path of ["/hu", "/login", "/register", "/dashboard", "/generate", "/tools", "/settings", "/api/projects"]) {
      expect(documentLocale(path)).toBe("hu");
    }
  });

  it.each(["http://invalid.example", "https://user:password@invalid.example", "not a URL"])("rejects unsafe site origin %s", (origin) => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", origin);
    expect(siteOrigin()).toBe(SITE_ORIGIN);
  });
});
