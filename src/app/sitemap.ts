import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/seo";
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();
  const languages = { en: `${origin}/`, hu: `${origin}/hu`, "x-default": `${origin}/` };
  // /en remains a compatible alias, but only canonical pages belong in the sitemap.
  return ["/", "/hu"].map(path => ({ url: origin + path, alternates: { languages } }));
}
