import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { authed } from "@/lib/apiAuth";
import { isInternalOwner } from "@/lib/security/internalAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Expose only the caller's navigation capability, never the owner's identity. */
export async function GET(req: NextRequest) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  return NextResponse.json({ isOwner: isInternalOwner(user.email) }, { headers });
}
