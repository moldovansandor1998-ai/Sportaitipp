import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { serviceClient } from "@/lib/supabase/server";
import { prepareAnalysisVideo } from "@/server/videoAnalysis/prepareVideo";
import { analyzeVideo } from "@/server/videoAnalysis/analyzeVideo";

export const runtime = "nodejs";
export const maxDuration = 180;
const Input = z.object({ videoAssetId: z.string().uuid(), duration: z.union([z.literal(5), z.literal(8), z.literal(10), z.literal(12), z.literal(15)]) }).strict();
const requests = new Map<string, number[]>();

export async function POST(request: NextRequest) {
  const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user } } = await auth.auth.getUser(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!user) return NextResponse.json({ error: "Jelentkezz be újra." }, { status: 401 });
  const input = Input.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Érvénytelen videó vagy videóhossz." }, { status: 400 });
  const db = serviceClient();
  const { data: profile } = await db.from("profiles").select("age_verified_at").eq("id", user.id).maybeSingle();
  if (!profile?.age_verified_at) return NextResponse.json({ error: "Korhatár-ellenőrzés szükséges." }, { status: 403 });
  const { data: asset } = await db.from("assets").select("bucket,object_path,media_type,content_type,bytes")
    .eq("id", input.data.videoAssetId).eq("owner_id", user.id).maybeSingle();
  if (!asset || asset.media_type !== "video") return NextResponse.json({ error: "A videó nem található." }, { status: 404 });
  if (!["video/mp4", "video/webm"].includes(asset.content_type) || asset.bytes < 1 || asset.bytes > 48 * 1024 * 1024)
    return NextResponse.json({ error: "MP4 vagy WebM videót válassz, legfeljebb 48 MB méretben." }, { status: 400 });
  const now = Date.now();
  for (const [id, times] of requests) if (times.every(time => time < now - 60_000)) requests.delete(id);
  const recent = (requests.get(user.id) ?? []).filter(time => time > now - 60_000);
  if (recent.length >= 3) return NextResponse.json({ error: "Várj egy percet az újabb elemzéssel." }, { status: 429 });
  requests.set(user.id, [...recent, now]);
  try {
    const { data: info, error: infoError } = await db.storage.from(asset.bucket).info(asset.object_path);
    if (infoError || !info || !Number(info.size) || Number(info.size) > 48 * 1024 * 1024)
      return NextResponse.json({ error: "A videó nem olvasható vagy túl nagy." }, { status: 400 });
    const { data: file, error } = await db.storage.from(asset.bucket).download(asset.object_path);
    if (error || !file || file.size > 48 * 1024 * 1024) throw new Error("VIDEO_DOWNLOAD_FAILED");
    const prepared = await prepareAnalysisVideo(Buffer.from(await file.arrayBuffer()));
    const analysis = await analyzeVideo(prepared.video, prepared.duration, input.data.duration);
    return NextResponse.json({ ...analysis, sourceDuration: prepared.duration, targetDuration: input.data.duration }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "VIDEO_DURATION_LIMIT") return NextResponse.json({ error: "Legfeljebb 30 másodperces videót válassz." }, { status: 400 });
    // Provider payloads may contain video bytes or internal authentication details; never log them.
    return NextResponse.json({ error: "A videó AI-elemzése nem sikerült. Próbáld újra később; a videókészítést nem indítottuk el." }, { status: 502 });
  }
}
