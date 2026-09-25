import "server-only";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase/server";

export async function authed(req: NextRequest) {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: { user } } = await sb.auth.getUser(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!user) return null;
  const { data: profile, error } = await serviceClient().from("profiles")
    .select("banned_until").eq("id", user.id).single();
  if (error) return null;
  const bannedUntil = (profile as { banned_until: string | null } | null)?.banned_until;
  if (bannedUntil && new Date(bannedUntil).getTime() > Date.now()) return null;
  return user;
}
