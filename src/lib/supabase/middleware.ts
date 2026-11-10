import { isInternalOwner, isInternalPath } from "@/lib/security/internalAccess";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/generate", "/model-studio", "/x-comments", "/dashboard", "/characters", "/gallery", "/jobs", "/settings", "/calendar", "/tools", "/content", "/projects", "/plans", "/admin"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Redirects and error responses must retain refreshed or cleared auth cookies.
  // Otherwise the browser keeps a stale session and retries it on the next request.
  const withSessionCookies = (result: NextResponse) => {
    response.cookies.getAll().forEach((cookie) => result.cookies.set(cookie));
    return result;
  };

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          cookies.forEach((c) => request.cookies.set(c.name, c.value));
          response = NextResponse.next({ request });
          cookies.forEach((c) => response.cookies.set(c.name, c.value, c.options));
        },
      },
    },
  );

  // getClaims verifies the signed session locally (refreshing it when needed),
  // avoiding a remote Auth user lookup on every page and API request.
  const { data } = await supabase.auth.getClaims();
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  const path = request.nextUrl.pathname;
  const needsAuth = PROTECTED_PREFIXES.some((p) => path.startsWith(p));

  if (userId) {
    const { data: profile } = await supabase.from("profiles").select("banned_until,role").eq("id", userId).single();
    if (!path.startsWith("/api/") && isInternalPath(path) && !isInternalOwner(typeof data?.claims?.email === "string" ? data.claims.email : null)) {
      const url = request.nextUrl.clone(); url.pathname = "/dashboard"; url.search = "";
      return withSessionCookies(NextResponse.redirect(url));
    }
    const bannedUntil = (profile as { banned_until: string | null } | null)?.banned_until;
    if (bannedUntil && new Date(bannedUntil).getTime() > Date.now()) {
      if (path.startsWith("/api/")) {
        return withSessionCookies(NextResponse.json({ error: "ACCOUNT_BANNED" }, { status: 403 }));
      }
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("error", "account_banned");
      return withSessionCookies(NextResponse.redirect(url));
    }
  }

  if (needsAuth && !userId) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return withSessionCookies(NextResponse.redirect(url));
  }
  if ((path === "/login" || path === "/register") && userId) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return withSessionCookies(NextResponse.redirect(url));
  }
  return response;
}
