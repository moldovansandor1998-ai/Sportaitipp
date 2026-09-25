import { authed } from "@/lib/apiAuth";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serviceClient } from "@/lib/supabase/server";
import { createHash } from "crypto";


const Body = z.object({
  title: z.string().trim().min(1).max(120),
  bullets: z.array(z.string().trim().min(1).max(200)).min(1).max(10),
  projectId: z.string().uuid().optional(),
  idempotencyKey: z.string().min(8).max(120),
});

export async function POST(req: NextRequest) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "validation" }, { status: 400 });
  if (parsed.data.projectId) {
    const { data: project } = await serviceClient().from("ppv_projects").select("id")
      .eq("id", parsed.data.projectId).eq("owner_id", user.id).maybeSingle();
    if (!project) return NextResponse.json({ error: "PROJECT_NOT_FOUND" }, { status: 404 });
  }
  const { renderCarouselPage } = await import("@/lib/contentEngine");
  const { runBilledTask } = await import("@/lib/billedTask");
  const r = await runBilledTask({
    userId: user.id, type: "carousel", cost: 10, idempotencyKey: parsed.data.idempotencyKey,
    fn: async () => {
      const svc = serviceClient();
      const pages = [parsed.data.title, ...parsed.data.bullets];
      const assetIds: string[] = [];
      for (const [i, page] of pages.entries()) {
        const svg = renderCarouselPage(parsed.data.title, i === 0 ? [] : [page], i, pages.length);
        const buf = Buffer.from(svg);
        const objectPath = `${user.id}/carousel/${crypto.randomUUID()}.svg`;
        const { error: upErr } = await svc.storage.from("assets").upload(objectPath, buf, { contentType: "image/svg+xml" });
        if (upErr) throw new Error(upErr.message);
        const { data: asset } = await svc.from("assets").insert({
          owner_id: user.id, bucket: "assets", object_path: objectPath,
          media_type: "image", content_type: "image/svg+xml", bytes: buf.length,
          sha256: createHash("sha256").update(buf).digest("hex"), source: "generation",
        }).select("id").single();
        if (!asset) throw new Error("ASSET_RECORD_FAILED");
        const assetId = (asset as { id: string }).id;
        const { error: galleryError } = await svc.from("gallery_items").insert({
          owner_id: user.id, asset_id: assetId, project_id: parsed.data.projectId ?? null,
          qc_status: "approved",
        });
        if (galleryError) throw new Error(galleryError.message);
        assetIds.push(assetId);
      }
      return { pageCount: pages.length, assetIds };
    },
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.error === "TASK_ALREADY_PROCESSED" ? 409 : 500 });
  return NextResponse.json(r.value, { status: 201 });
}
