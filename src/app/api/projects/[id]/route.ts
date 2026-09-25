import { authed } from "@/lib/apiAuth";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serviceClient } from "@/lib/supabase/server";

const PatchBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(["general", "carousel", "viral_trend", "ppv_set"]).optional(),
}).strict().refine((v) => Object.keys(v).length > 0);


export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = PatchBody.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "validation" }, { status: 400 });
  const { data, error } = await serviceClient().from("projects").update(parsed.data)
    .eq("id", id).eq("owner_id", user.id).select("id").single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await serviceClient().from("projects").delete().eq("id", id).eq("owner_id", user.id);
  return NextResponse.json({ ok: true });
}
