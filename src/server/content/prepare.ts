import "server-only";
import { z } from "zod";
import { serviceClient } from "@/lib/supabase/server";
import { contentAiConfigured, generateContentJson } from "@/lib/contentAi";
import { prepareValidatedJobInput } from "@/server/jobs/prepareJob";
import { buildRouter } from "@/lib/providers";
import { createJobWithHold } from "@/lib/credits/rpc";
import { scheduleKick } from "@/server/jobs/schedule";

const Copy = z.object({ slides: z.array(z.string().min(1).max(220)).length(3), caption: z.string().min(1).max(900), scene: z.string().min(1).max(500) });
const zone = "Europe/Budapest";
type Slot = { date: string; hour: number; due: string };

function slotAt(now: Date): Slot | null {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (key: string) => parts.find(p => p.type === key)?.value ?? "";
  const hour = Number(part("hour"));
  if (![11, 15, 19].includes(hour)) return null;
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  const offsetText = new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(now).find(p => p.type === "timeZoneName")?.value ?? "GMT+1";
  const offset = Number(offsetText.match(/GMT([+-]\d+)/)?.[1] ?? 1);
  return { date, hour: hour + 1,
    due: new Date(Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00Z`) - offset * 3600000).toISOString() };
}

// The override is available only to the owner-authenticated preview route; cron always uses real time.
export async function prepareContent(now = new Date(), owner?: string, maxItems = 1) {
  const slot = slotAt(now);
  const sb = serviceClient();
  let created = 0;
  if (slot) {
  const { data: characters, error: characterError } = await sb.from("characters")
    .select("id,name,owner_id,active_version_id").eq("status", "active")
    .not("active_version_id", "is", null).order("id").limit(100);
  if (characterError) throw characterError;
  for (const character of characters ?? []) {
    if (owner && character.owner_id !== owner) continue;
    // Public platform accounts determine which model receives which preparation.
    const { data: accounts } = await sb.from("model_accounts").select("platform")
      .eq("character_id", character.id).eq("owner_id", character.owner_id);
    const platforms = new Set((accounts ?? []).map(a => a.platform));
    const destinations = ["tiktok", ...(slot.hour === 20 && platforms.has("telegram") ? ["telegram"] : []),
      ...(slot.hour === 20 && platforms.has("fanvue") ? ["fanvue_public", "fanvue_paid"] : [])];
    for (const platform of destinations) {
      const { data, error } = await sb.from("model_content_items").upsert({
        owner_id: character.owner_id, character_id: character.id, platform,
        local_date: slot.date, post_hour: slot.hour, due_at: slot.due,
        aspect_ratio: platform === "tiktok" ? "9:16" : "flexible",
      }, { onConflict: "character_id,platform,local_date,post_hour", ignoreDuplicates: true }).select("id");
      if (error) throw error;
      created += data?.length ?? 0;
    }
  }
  }
  // A bounded number per cron invocation keeps OpenAI/provider latency under the function limit.
  let pendingQuery = sb.from("model_content_items").select("*")
    .eq("status", "planned").lte("due_at", now.toISOString());
  if (owner) pendingQuery = pendingQuery.eq("owner_id", owner);
  const { data: pending, error } = await pendingQuery.order("due_at").limit(maxItems);
  if (error) throw error;
  let processed = 0;
  for (const item of pending ?? []) {
    if (owner && item.owner_id !== owner) continue;
    const { data: claimed } = await sb.from("model_content_items")
      .update({ status: "generating", error: null }).eq("id", item.id).eq("status", "planned").select("id").maybeSingle();
    if (!claimed) continue;
    try {
      if (item.platform === "fanvue_paid") throw new Error("PAID_IMAGE_PROVIDER_NOT_VERIFIED");
      if (!contentAiConfigured()) throw new Error("CONTENT_AI_NOT_CONFIGURED");
      const { data: character } = await sb.from("characters").select("name").eq("id", item.character_id).single();
      const copy = Copy.parse(await generateContentJson<z.infer<typeof Copy>>(
        "Write Hungarian social media copy as JSON with exactly three short slide texts, a caption and an English photorealistic scene description. Do not claim a live trend, ranking or source you have not checked. Avoid text embedded in the photo. The subject is an adult fictional character; keep public imagery suitable for social platforms.",
        JSON.stringify({ model: character?.name, platform: item.platform, postingHour: item.post_hour,
          inspiration: "A supplied example uses a natural mirror selfie and a three-slide Hungarian relationship story. Produce an original variation; do not copy it.",
          format: item.aspect_ratio }),
      ));
      // Paid content needs its own verified adult-capable image workflow. Never silently
      // substitute a public image while reporting the paid set as ready.
      const payload = { prompt: `${copy.scene}. Adult woman, consistent face and body, natural anatomy, candid photography, no typography or watermark.`,
        imageSize: item.aspect_ratio === "9:16" ? "portrait_16_9" : "portrait_4_3",
        numImages: item.platform === "tiktok" ? 3 : 1 };
      const prepared = await prepareValidatedJobInput({ userId: item.owner_id, type: "image_generation", characterId: item.character_id, payload });
      if (prepared.error) throw new Error(prepared.error);
      const estimate = await buildRouter().estimate("image_generation", prepared.payload);
      const key = `content:${item.id}`;
      const { data: existing } = await sb.from("generation_jobs").select("id").eq("idempotency_key", key).maybeSingle();
      const jobId = existing?.id ?? await createJobWithHold({ userId: item.owner_id, type: "image_generation",
        characterId: item.character_id, payload: prepared.payload, idempotencyKey: key, costEstimate: estimate.credits });
      const { error: saveError } = await sb.from("model_content_items")
        .update({ copy, image_jobs: [jobId] }).eq("id", item.id);
      if (saveError) throw saveError;
      scheduleKick(jobId);
      processed++;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      await sb.from("model_content_items").update({ status: "failed", error: message.slice(0, 250) }).eq("id", item.id);
      console.error(JSON.stringify({ scope: "content.prepare", itemId: item.id, error: message }));
    }
  }
  return { slot, created, processed };
}

export async function refreshContentJobs() {
  const sb = serviceClient();
  const { data: items } = await sb.from("model_content_items").select("id,image_jobs")
    .eq("status", "generating").neq("image_jobs", "{}").limit(40);
  for (const item of items ?? []) {
    const jobId = item.image_jobs?.[0];
    if (!jobId) continue;
    const { data: job } = await sb.from("generation_jobs").select("status,error").eq("id", jobId).maybeSingle();
    if (job?.status === "completed") await sb.from("model_content_items").update({ status: "ready" }).eq("id", item.id);
    if (job?.status === "failed" || job?.status === "cancelled") await sb.from("model_content_items")
      .update({ status: "failed", error: job.error ?? job.status }).eq("id", item.id);
  }
}
