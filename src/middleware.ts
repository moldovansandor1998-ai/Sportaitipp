import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { documentLocale, PUBLIC_LOCALE_HEADER } from "@/lib/public-locale";
import { SOCIAL_IMAGE_PATH } from "@/lib/seo";

const PUBLIC_PATHS = new Set([
  "/", "/en", "/hu", "/robots.txt", "/sitemap.xml", "/icon.svg", SOCIAL_IMAGE_PATH,
  "/images/feature-photos/image-generation.png",
  "/images/feature-photos/video-motion.png",
  "/images/feature-photos/voice-talking-video.png",
  "/images/feature-photos/content-planning.png",
  "/images/feature-photos/creative-library.png",
]);

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // Overwrite client-supplied values; this is a display-language signal only.
  // updateSession forwards these request headers while preserving auth/cookies.
  request.headers.set(PUBLIC_LOCALE_HEADER, documentLocale(path));
  const response = await updateSession(request);
  if (!PUBLIC_PATHS.has(path) && !path.startsWith("/_next/")) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/webhooks).*)"],
};
