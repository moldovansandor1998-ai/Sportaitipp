import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// OAuth / e-mail-confirm visszahívás: kód cseréje sessionre,
// a session cookie-k createServerClient-en keresztül visszaírva.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (toSet) => {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          },
        },
      },
    );
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL("/dashboard", req.url));
}
