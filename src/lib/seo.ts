import type { Metadata } from "next";
export const SITE_ORIGIN = "https://startaicreator.com";
export const SOCIAL_IMAGE_PATH = "/images/social/start-ai-creator-og-v1.jpg";
export const SOCIAL_IMAGE_WIDTH = 1200;
export const SOCIAL_IMAGE_HEIGHT = 630;
/** Default public domain verified before the Start AI Creator rebrand release. */
export function siteOrigin(): string {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SITE_URL || SITE_ORIGIN);
    return url.protocol === "https:" && !url.username && !url.password ? url.origin : SITE_ORIGIN;
  } catch { return SITE_ORIGIN; }
}
export function landingMetadata(locale: "hu" | "en"): Metadata {
  const origin = siteOrigin();
  const path = locale === "en" ? "/" : "/hu";
  const title = locale === "en" ? "Start AI Creator | AI characters, images and video tools" : "Start AI Creator | AI-karakterek, képek és videók";
  const description = locale === "en"
    ? "Explore AI character, image, video and voice tools in one creative workspace. Manage references and organize your content with Start AI Creator."
    : "AI-karakterek létrehozása és kezelése referenciaképekkel, kép- és videóeszközökkel, hangmunkafolyamatokkal és rendezett galériával a Start AI Creator platformon.";
  const image = {
    url: origin + SOCIAL_IMAGE_PATH,
    width: SOCIAL_IMAGE_WIDTH,
    height: SOCIAL_IMAGE_HEIGHT,
    type: "image/jpeg",
    alt: locale === "en"
      ? "Start AI Creator: characters, images, video and voice. AI-generated creative illustration."
      : "Start AI Creator: karakterek, képek, videó és hang. AI-val készült kreatív illusztráció.",
  };
  return {
    title: { absolute: title }, description,
    alternates: { canonical: origin + path, languages: { en: origin + "/", hu: origin + "/hu", "x-default": origin + "/" } },
    openGraph: { title, description, type: "website", siteName: "Start AI Creator", url: origin + path, locale: locale === "en" ? "en_US" : "hu_HU", alternateLocale: [locale === "en" ? "hu_HU" : "en_US"], images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [{ url: image.url, alt: image.alt }] },
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large" } },
  };
}
