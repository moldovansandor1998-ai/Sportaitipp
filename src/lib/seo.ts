import type { Metadata } from "next";
import { landingContent } from "@/components/marketing/content";
import { PUBLIC_LOCALES, OPEN_GRAPH_LOCALES, publicLocalePath, type PublicLocale } from "./public-locale";
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
export function publicLanguageAlternates(origin = siteOrigin()): Record<string, string> {
  return { ...Object.fromEntries(PUBLIC_LOCALES.map(locale => [locale, origin + publicLocalePath(locale)])), "x-default": origin + "/" };
}
export function landingMetadata(locale: PublicLocale): Metadata {
  const origin = siteOrigin();
  const path = publicLocalePath(locale);
  const copy = landingContent[locale];
  const title = `Start AI Creator | ${copy.seoTitle}`;
  const description = copy.seoDescription;
  const image = {
    url: origin + SOCIAL_IMAGE_PATH, width: SOCIAL_IMAGE_WIDTH, height: SOCIAL_IMAGE_HEIGHT,
    type: "image/jpeg", alt: copy.socialAlt,
  };
  return {
    title: { absolute: title }, description,
    alternates: { canonical: origin + path, languages: publicLanguageAlternates(origin) },
    openGraph: { title, description, type: "website", siteName: "Start AI Creator", url: origin + path,
      locale: OPEN_GRAPH_LOCALES[locale], alternateLocale: PUBLIC_LOCALES.filter(other => other !== locale).map(other => OPEN_GRAPH_LOCALES[other]), images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [{ url: image.url, alt: image.alt }] },
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large" } },
  };
}
