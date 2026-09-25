import { authed } from "@/lib/apiAuth";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serviceClient } from "@/lib/supabase/server";


const Body = z.object({ url: z.string().url(), idempotencyKey: z.string().min(8).max(120) });
const TIKTOK_HOST = "www.tiktok.com";

export async function POST(req: NextRequest) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "validation" }, { status: 400 });
  const target = new URL(parsed.data.url);
  if (target.hostname !== TIKTOK_HOST) return NextResponse.json({ error: "URL_NOT_ALLOWED" }, { status: 400 });

  const { runBilledTask } = await import("@/lib/billedTask");
  const r = await runBilledTask({
    userId: user.id, type: "tiktok_import", cost: 5, idempotencyKey: parsed.data.idempotencyKey,
    fn: async () => {
      const res = await fetch(`https://${TIKTOK_HOST}/oembed?url=${encodeURIComponent(parsed.data.url)}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`TikTok oEmbed ${res.status}`);
      const data = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
      const svc = serviceClient();
      const { data: row } = await svc.from("viral_trends").insert({
        owner_id: user.id, source_url: parsed.data.url,
        title: data.title ?? "TikTok import", platform: "tiktok", status: "ready",
        analysis: { author: data.author_name ?? null, thumbnail: data.thumbnail_url ?? null },
      }).select("id").single();
      return { trendId: (row as { id: string } | null)?.id ?? null, title: data.title, author: data.author_name };
    },
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.error === "TASK_ALREADY_PROCESSED" ? 409 : 500 });
  return NextResponse.json(r.value, { status: 201 });
}
