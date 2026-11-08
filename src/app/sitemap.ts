import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/seo";
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();
  const languages = { hu: `${origin}/`, en: `${origin}/en` };
  return ["/", "/en"].map(path => ({ url: origin + path, alternates: { languages } }));
}
