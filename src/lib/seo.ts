import type { Metadata } from "next";
export const SITE_ORIGIN = "https://startaicreator.com";
/** Default public domain verified before the Start AI Creator rebrand release. */
export function siteOrigin(): string {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SITE_URL || SITE_ORIGIN);
    return url.protocol === "https:" && !url.username && !url.password ? url.origin : SITE_ORIGIN;
  } catch { return SITE_ORIGIN; }
}
export function landingMetadata(locale: "hu" | "en"): Metadata {
  const origin = siteOrigin();
  const path = locale === "en" ? "/en" : "/";
  const title = locale === "en" ? "Start AI Creator | AI characters, images and video tools" : "Start AI Creator | AI-karakterek, képek és videók";
  const description = locale === "en"
    ? "Create and manage AI characters with reference images, image and video tools, voice workflows and an organized gallery in Start AI Creator."
    : "AI-karakterek létrehozása és kezelése referenciaképekkel, kép- és videóeszközökkel, hangmunkafolyamatokkal és rendezett galériával a Start AI Creator platformon.";
  return {
    title: { absolute: title }, description,
    alternates: { canonical: origin + path, languages: { hu: origin + "/", en: origin + "/en", "x-default": origin + "/" } },
    openGraph: { title, description, type: "website", siteName: "Start AI Creator", url: origin + path, locale: locale === "en" ? "en_US" : "hu_HU", alternateLocale: [locale === "en" ? "hu_HU" : "en_US"] },
    twitter: { card: "summary", title, description },
    robots: { index: true, follow: true },
  };
}
