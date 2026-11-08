import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { landingContent, filterFeatures } from "@/components/marketing/content";
import { PUBLIC_LOCALES, PUBLIC_LANGUAGE_NAMES, publicLocalePath, publicLocaleFromPath, documentLocale } from "@/lib/public-locale";

function textLeaves(value: unknown, prefix = ""): Record<string, string> {
  if (typeof value === "string") return { [prefix]: value };
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => Object.entries(textLeaves(child, `${prefix}.${key}`))));
}
describe("complete public language coverage", () => {
  it.each(PUBLIC_LOCALES)("%s has complete copy, a canonical route and consistent catalog structure", locale => {
    const copy = landingContent[locale];
    const actual = textLeaves(copy), english = textLeaves(landingContent.en);
    expect(Object.keys(actual).sort()).toEqual(Object.keys(english).sort());
    for (const value of Object.values(actual)) expect(value.trim().length).toBeGreaterThan(0);
    expect(copy.features.map(({ id, category, art, href, provider }) => ({ id, category, art, href, provider }))).toEqual(landingContent.en.features.map(({ id, category, art, href, provider }) => ({ id, category, art, href, provider })));
    expect(copy.questions).toHaveLength(5);
    expect(copy.availabilityItems).toHaveLength(3);
    expect(copy.filters.map(filter => filter.id)).toEqual(landingContent.en.filters.map(filter => filter.id));
    expect(filterFeatures(copy.features, "characters", "")).toHaveLength(1);
    expect(filterFeatures(copy.features, "all", copy.features[0].title).map(feature => feature.id)).toContain("characters");
    expect(filterFeatures(copy.features, "all", "zzznomatch")).toHaveLength(0);
    expect(documentLocale(publicLocalePath(locale))).toBe(locale);
    expect(publicLocaleFromPath(publicLocalePath(locale) + (locale === "en" ? "" : "/"))).toBe(locale);
    const page = readFileSync(`src/app/${locale === "en" ? "" : locale + "/"}page.tsx`, "utf8");
    expect(page).toContain(`landingMetadata("${locale}")`);
    expect(page).toContain(`locale="${locale}"`);
    // Prevent accidental English fallback on substantive translated copy.
    if (locale !== "en") for (const key of ["intro", "heroNote", "catalogNote", "availabilityNote", "seoDescription", "questions.0.1", "questions.1.1", "questions.2.1", "questions.3.1", "questions.4.1"]) expect(actual["." + key]).not.toBe(english["." + key]);
  });
  it("has eight named choices, English root and no guessed language redirects", () => {
    expect(PUBLIC_LOCALES).toHaveLength(8);
    expect(Object.keys(PUBLIC_LANGUAGE_NAMES)).toHaveLength(8);
    expect(publicLocalePath("en")).toBe("/");
    expect(publicLocaleFromPath("/en")).toBe("en");
    expect(publicLocaleFromPath("/de/private")).toBeNull();
    expect(publicLocaleFromPath("/zz")).toBeNull();
    const picker = readFileSync("src/components/marketing/LanguagePicker.tsx", "utf8");
    expect(picker).toContain("PUBLIC_LOCALES.map");
    expect(picker).toContain('hrefLang={other} lang={other}');
    expect(picker).toContain("rememberPublicLocale(other)");
    expect(readFileSync("src/components/marketing/DocumentLanguage.tsx", "utf8")).toContain("rememberPublicLocale(locale)");
    const middleware = readFileSync("src/middleware.ts", "utf8");
    expect(middleware).not.toMatch(/accept-language|geolocation|geo\.country/);
  });
});
