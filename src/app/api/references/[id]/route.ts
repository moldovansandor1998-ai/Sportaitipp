import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase/server";

// A már felhasznált tréningadatot és assetet megőrizzük a korábbi modell
// nyomon követhetőségéhez. A referencia listából csak a csatolást töröljük.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user } } = await auth.auth.getUser(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const svc = serviceClient();
  const { data: ref, error: lookupError } = await svc.from("character_reference_images")
    .select("id,character_id,characters!inner(owner_id)").eq("id", id).eq("characters.owner_id", user.id).maybeSingle();
  if (lookupError) return NextResponse.json({ error: "REFERENCE_LOOKUP_FAILED" }, { status: 500 });
  if (!ref) return NextResponse.json({ error: "REFERENCE_NOT_FOUND" }, { status: 404 });

  const { error } = await svc.from("character_reference_images").delete().eq("id", id).eq("character_id", ref.character_id);
  if (error) return NextResponse.json({ error: "REFERENCE_DELETE_FAILED" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
