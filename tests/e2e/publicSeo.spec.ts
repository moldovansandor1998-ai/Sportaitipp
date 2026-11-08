import { expect, test } from "@playwright/test";

const origin = "https://startaicreator.com";
const imagePath = "/images/social/start-ai-creator-og-v1.jpg";

test.describe("international landing SEO and social previews", () => {
  for (const [path, language, canonical] of [["/", "en", "/"], ["/en", "en", "/"], ["/hu", "hu", "/hu"]]) {
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
      expect(html).toContain(language === "en" ? "Your idea." : "Az ötlet a tiéd.");
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

  test("public language links and internal client navigation keep document language correct", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.getByRole("link", { name: "Magyar", exact: true }).first().click();
    await expect(page).toHaveURL(/\/hu$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "hu");
    await page.getByRole("link", { name: "English", exact: true }).first().click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.getByRole("link", { name: /^Sign in/ }).first().click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "hu");
    await page.goBack();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("sitemap exposes English and Hungarian canonicals while internal pages stay private", async ({ request }) => {
    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    const xml = await sitemap.text();
    expect(xml).toContain(`<loc>${origin}/</loc>`);
    expect(xml).toContain(`<loc>${origin}/hu</loc>`);
    expect(xml).not.toContain(`<loc>${origin}/en</loc>`);
    expect(xml).toContain('hreflang="x-default"');
    const login = await request.get("/login");
    expect(login.headers()["x-robots-tag"]).toContain("noindex");
    const dashboard = await request.get("/dashboard", { maxRedirects: 0 });
    expect(dashboard.status()).toBe(307);
    expect(dashboard.headers()["location"]).toContain("/login?next=%2Fdashboard");
  });
});
