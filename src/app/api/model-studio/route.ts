import { authed } from "@/lib/apiAuth";
import { serviceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
const Account = z.object({
  id: z.string().uuid(), account_url: z.string().url().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export async function GET(req: NextRequest) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const svc = serviceClient();
  const [accounts, characters, items] = await Promise.all([
    svc.from("model_accounts").select("id,character_id,model_name,platform,login_email,account_url,notes").eq("owner_id", user.id).order("model_name"),
    svc.from("characters").select("id,name,status,active_version_id").eq("owner_id", user.id),
    svc.from("model_content_items").select("*").eq("owner_id", user.id).order("due_at", { ascending: false }).limit(100),
  ]);
  if (accounts.error || characters.error || items.error) return NextResponse.json({ error: "MODEL_STUDIO_UNAVAILABLE" }, { status: 500 });
  return NextResponse.json({ accounts: accounts.data, characters: characters.data, items: items.data });
}

export async function PATCH(req: NextRequest) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Account.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "validation" }, { status: 400 });
  const { id, ...changes } = parsed.data;
  const { data, error } = await serviceClient().from("model_accounts")
    .update(changes).eq("id", id).eq("owner_id", user.id).select("id").maybeSingle();
  if (error || !data) return NextResponse.json({ error: "ACCOUNT_UPDATE_FAILED" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
