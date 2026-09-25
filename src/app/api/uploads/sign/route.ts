export const runtime = "nodejs";

// Aláírt feltöltési URL a privát 'references' bucketbe (felhasználói JWT-vel).
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { UPLOAD_LIMITS } from "@/lib/security/validation";
import { serviceClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: { user } } = await sb.auth.getUser(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const filename: string = String(body.filename ?? "ref.jpg").replace(/[^\w.\-]/g, "_").slice(-80);
  const kind: string = ["face", "half_body", "full_body"].includes(body.kind) ? body.kind : "face";
  const objectPath = `${user.id}/${randomUUID()}-${filename}`;

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Reference upload signing unavailable: SUPABASE_SERVICE_ROLE_KEY is missing");
    return NextResponse.json({ error: "UPLOAD_SERVICE_NOT_CONFIGURED" }, { status: 503 });
  }

  const svc = serviceClient();
  const { data, error } = await svc.storage.from("references").createSignedUploadUrl(objectPath);
  if (error || !data?.token) {
    console.error("Reference upload signing failed:", error);
    return NextResponse.json({ error: "UPLOAD_SIGNING_FAILED" }, { status: 502 });
  }

  return NextResponse.json({
    signedUrl: data.signedUrl,
    objectPath,
    token: data.token,
    limits: UPLOAD_LIMITS,
    kind,
  });
}
