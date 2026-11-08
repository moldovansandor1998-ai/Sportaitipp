import { expect, test } from "@playwright/test";
import { APP_LOCALES } from "../../src/lib/app-i18n";
for (const locale of APP_LOCALES) for (const path of ["/login", "/register", "/auth/reset"]) {
  test(`${path} renders the selected ${locale} language before hydration`, async ({ request }) => {
    const response = await request.get(path, { headers: { cookie: `start-ai-locale=${locale}` } });
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain(`<html lang="${locale}"`);
    expect(html).toContain(`value="${locale}" selected=""`);
    expect(response.headers()["x-robots-tag"]).toContain("noindex");
  });
}
