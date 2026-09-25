import { createBrowserClient } from "@supabase/ssr";

// Kliensoldali kliens – csak anon kulccsal (soha service role!).
export function browserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
