import { authed } from "@/lib/apiAuth";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serviceClient } from "@/lib/supabase/server";


const Body = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["general", "carousel", "viral_trend", "ppv_set"]).default("general"),
});

export async function GET(req: NextRequest) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data } = await serviceClient().from("projects").select("id,name,kind,created_at")
    .eq("owner_id", user.id).order("created_at", { ascending: false });
  return NextResponse.json({ projects: data ?? [] });
}

export async function POST(req: NextRequest) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "validation" }, { status: 400 });
  const { data, error } = await serviceClient().from("projects")
    .insert({ owner_id: user.id, ...parsed.data }).select("id,name,kind").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
