import type { MetadataRoute } from "next";
import { siteOrigin, publicLanguageAlternates } from "@/lib/seo";
import { PUBLIC_LOCALES, publicLocalePath } from "@/lib/public-locale";
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();
  const languages = publicLanguageAlternates(origin);
  // /en remains a compatible alias, but only canonical pages belong in the sitemap.
  return PUBLIC_LOCALES.map(locale => ({ url: origin + publicLocalePath(locale), alternates: { languages } }));
}
