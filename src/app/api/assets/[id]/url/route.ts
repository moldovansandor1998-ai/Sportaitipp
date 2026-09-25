export const runtime = "nodejs";

// Egyedi asset signed URL – kizárólag tulajdon-ellenőrzés után.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: { user } } = await sb.auth.getUser(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const svc = serviceClient();
  const { data: asset } = await svc.from("assets")
    .select("bucket,object_path").eq("id", id).eq("owner_id", user.id).single();
  if (!asset) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const { data } = await svc.storage.from(asset.bucket).createSignedUrl(asset.object_path, 3600);
  return NextResponse.json({ url: data?.signedUrl ?? null });
}
