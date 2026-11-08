import { expect, test } from "@playwright/test";
import { PUBLIC_LOCALES, PUBLIC_LANGUAGE_NAMES, publicLocalePath } from "../../src/lib/public-locale";
import { landingContent } from "../../src/components/marketing/content";

const origin = "https://startaicreator.com";
const imagePath = "/images/social/start-ai-creator-og-v1.jpg";

test.describe("international landing SEO and social previews", () => {
  for (const [path, language, canonical] of [...PUBLIC_LOCALES.map(locale => [publicLocalePath(locale), locale, publicLocalePath(locale)]), ["/en", "en", "/"]]) {
    test(`${path} sends localized HTML and complete metadata without JavaScript`, async ({ request }) => {
      const response = await request.get(path, { headers: { "user-agent": "facebookexternalhit/1.1" } });
      expect(response.status()).toBe(200);
      expect(response.headers()["x-robots-tag"] ?? "").not.toContain("noindex");
      const html = await response.text();
      const head = html.split("</head>")[0];
      expect(html).toContain(`<html lang="${language}"`);
      expect(head).toContain(`rel="canonical" href="${origin + canonical}"`);
      expect(head).toContain(`property="og:image" content="${origin + imagePath}"`);
      expect(head).toContain('property="og:image:width" content="1200"');
      expect(head).toContain('property="og:image:height" content="630"');
      expect(head).toContain('property="og:image:type" content="image/jpeg"');
      expect(head).toContain('name="twitter:card" content="summary_large_image"');
      expect(head).toContain(`name="twitter:image" content="${origin + imagePath}"`);
      expect(head).toContain(`hrefLang="en" href="${origin}/"`);
      expect(head).toContain(`hrefLang="hu" href="${origin}/hu"`);
      expect(head).toContain(`hrefLang="x-default" href="${origin}/"`);
      expect(html).toContain(landingContent[language as keyof typeof landingContent].title);
      for (const locale of PUBLIC_LOCALES) expect(head).toContain(`hrefLang="${locale}" href="${origin + publicLocalePath(locale)}"`);
    });
  }

  test("the preview image is publicly fetchable with crawler-friendly headers", async ({ request }) => {
    const response = await request.get(imagePath, { headers: { "user-agent": "Twitterbot/1.0" } });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/jpeg");
    expect(response.headers()["x-robots-tag"] ?? "").not.toContain("noindex");
    expect(response.headers()["cache-control"] ?? "").not.toMatch(/private|no-store/);
    expect((await response.body()).byteLength).toBeGreaterThan(10_000);
  });

  test("all eight deliberate language choices survive back and forward navigation", async ({ page }) => {
    await page.goto("/");
    for (const locale of PUBLIC_LOCALES) {
      await page.locator("header details summary").click();
      await page.locator("header").getByRole("link", { name: PUBLIC_LANGUAGE_NAMES[locale], exact: true }).click();
      await expect(page).toHaveURL(new RegExp(publicLocalePath(locale) === "/" ? "/$" : `/${locale}$`));
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(landingContent[locale].title);
      expect((await page.context().cookies()).find(cookie => cookie.name === "start-ai-locale")?.value).toBe(locale);
    }
    await page.goBack();
    await expect(page.locator("html")).toHaveAttribute("lang", "sk");
    await expect.poll(async () => (await page.context().cookies()).find(cookie => cookie.name === "start-ai-locale")?.value).toBe("sk");
    await page.goForward();
    await expect(page.locator("html")).toHaveAttribute("lang", "pl");
    await expect.poll(async () => (await page.context().cookies()).find(cookie => cookie.name === "start-ai-locale")?.value).toBe("pl");
  });

  for (const locale of PUBLIC_LOCALES) {
    test(`${locale} supports mobile catalog filtering and search`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(publicLocalePath(locale));
      const copy = landingContent[locale];
      await expect(page.locator("#features article")).toHaveCount(6);
      await page.getByRole("button", { name: copy.filters[1].label, exact: true }).click();
      await expect(page.locator("#features article")).toHaveCount(1);
      await page.getByRole("searchbox", { name: copy.search }).fill("zzznomatch");
      await expect(page.getByText(copy.noResults, { exact: true })).toBeVisible();
      await page.getByRole("button", { name: copy.clear, exact: true }).click();
      await expect(page.locator("#features article")).toHaveCount(6);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }

  test("sitemap exposes all eight canonicals while internal pages stay private", async ({ request }) => {
    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    const xml = await sitemap.text();
    expect(xml).toContain(`<loc>${origin}/</loc>`);
    for (const locale of PUBLIC_LOCALES) expect(xml).toContain(`<loc>${origin + publicLocalePath(locale)}</loc>`);
    expect(xml).not.toContain(`<loc>${origin}/en</loc>`);
    expect(xml).toContain('hreflang="x-default"');
    const login = await request.get("/login");
    expect(login.headers()["x-robots-tag"]).toContain("noindex");
    const dashboard = await request.get("/dashboard", { maxRedirects: 0 });
    expect(dashboard.status()).toBe(307);
    expect(dashboard.headers()["location"]).toContain("/login?next=%2Fdashboard");
  });
});
