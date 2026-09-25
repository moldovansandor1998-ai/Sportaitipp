import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/dashboard", "/characters", "/gallery", "/jobs", "/settings", "/calendar", "/tools", "/content", "/projects", "/plans", "/admin"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

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

  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const needsAuth = PROTECTED_PREFIXES.some((p) => path.startsWith(p));

  if (user) {
    const { data: profile } = await supabase.from("profiles").select("banned_until").eq("id", user.id).single();
    const bannedUntil = (profile as { banned_until: string | null } | null)?.banned_until;
    if (bannedUntil && new Date(bannedUntil).getTime() > Date.now()) {
      if (path.startsWith("/api/")) {
        return NextResponse.json({ error: "ACCOUNT_BANNED" }, { status: 403 });
      }
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("error", "account_banned");
      return NextResponse.redirect(url);
    }
  }

  if (needsAuth && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }
  if ((path === "/login" || path === "/register") && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }
  return response;
}
