// Albumok: létrehozás + lista (tulajdonossal).
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase/server";

const Body = z.object({ name: z.string().trim().min(1).max(120) });

export async function GET(req: NextRequest) {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user } } = await sb.auth.getUser(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data } = await serviceClient().from("albums").select("id,name,created_at").eq("owner_id", user.id).order("created_at");
  return NextResponse.json({ albums: data ?? [] });
}

export async function POST(req: NextRequest) {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user } } = await sb.auth.getUser(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "validation" }, { status: 400 });
  const { data, error } = await serviceClient().from("albums")
    .insert({ owner_id: user.id, name: parsed.data.name }).select("id,name").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
