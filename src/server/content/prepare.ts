import "server-only";
import { z } from "zod";
import { serviceClient } from "@/lib/supabase/server";
import { contentAiConfigured, generateContentJson } from "@/lib/contentAi";
import { prepareValidatedJobInput } from "@/server/jobs/prepareJob";
import { buildRouter } from "@/lib/providers";
import { createJobWithHold } from "@/lib/credits/rpc";
import { scheduleKick } from "@/server/jobs/schedule";

const Copy = z.object({ slides: z.array(z.string().min(1).max(220)).length(3), caption: z.string().min(1).max(900),
  scene: z.string().min(1).max(500).default("Natural candid mirror selfie in a contemporary room, coherent adult body proportions, realistic soft lighting") });
const zone = "Europe/Budapest";
type Slot = { date: string; hour: number; due: string; prepare: string };

function slotAt(now: Date): Slot | null {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (key: string) => parts.find(p => p.type === key)?.value ?? "";
  const hour = Number(part("hour"));
  if (![10, 14, 18].includes(hour)) return null;
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  const offsetText = new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(now).find(p => p.type === "timeZoneName")?.value ?? "GMT+1";
  const offset = Number(offsetText.match(/GMT([+-]\d+)/)?.[1] ?? 1);
  const prepare = new Date(Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00Z`) - offset * 3600000);
  return { date, hour: hour + 2, prepare: prepare.toISOString(),
    due: new Date(prepare.getTime() + 3600000).toISOString() };
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
    // Drafts are useful even if a publishing account has not been linked yet.
    const destinations = ["tiktok", ...(slot.hour === 20 ? ["telegram", "fanvue_public"] : [])];
    for (const platform of destinations) {
      const { data, error } = await sb.from("model_content_items").upsert({
        owner_id: character.owner_id, character_id: character.id, platform,
        local_date: slot.date, post_hour: slot.hour, due_at: slot.due, prepare_at: slot.prepare,
        aspect_ratio: platform === "tiktok" ? "9:16" : "flexible",
      }, { onConflict: "character_id,platform,local_date,post_hour", ignoreDuplicates: true }).select("id");
      if (error) throw error;
      created += data?.length ?? 0;
    }
  }
  }
  // A bounded number per cron invocation keeps OpenAI/provider latency under the function limit.
  let pendingQuery = sb.from("model_content_items").select("*")
    .eq("status", "planned").lte("prepare_at", now.toISOString());
  if (owner) pendingQuery = pendingQuery.eq("owner_id", owner);
  const { data: pending, error } = await pendingQuery.order("due_at").limit(maxItems);
  if (error) throw error;
  let processed = 0;
  for (const item of pending ?? []) {
    if (owner && item.owner_id !== owner) continue;
    const pool = item.platform === "tiktok" ? "tiktok" : "telegram_fanvue";
    const slideCount = item.platform === "tiktok" ? 3 : 1;
    if (item.platform === "fanvue_paid") continue;
    const [{ count: free, error: countError }, { count: reserved, error: reserveError }] = await Promise.all([
      sb.from("content_source_images").select("id", { count: "exact", head: true })
        .eq("owner_id", item.owner_id).eq("pool", pool).is("used_at", null),
      sb.from("content_source_uses").select("id", { count: "exact", head: true })
        .eq("item_id", item.id).eq("revision", item.regeneration_count ?? 0),
    ]);
    if (countError || reserveError) throw countError ?? reserveError;
    if ((free ?? 0) + (reserved ?? 0) < slideCount) {
      await sb.from("model_content_items").update({ error: `WAITING_FOR_${pool.toUpperCase()}_SOURCES`,
        prepare_at: new Date(now.getTime() + 5 * 60_000).toISOString() }).eq("id", item.id).eq("status", "planned");
      continue;
    }
    const { data: claimed } = await sb.from("model_content_items")
      .update({ status: "generating", error: null }).eq("id", item.id).eq("status", "planned").select("id").maybeSingle();
    if (!claimed) continue;
    try {
      if (item.platform === "fanvue_paid") throw new Error("PAID_IMAGE_PROVIDER_NOT_VERIFIED");
      if (!contentAiConfigured()) throw new Error("CONTENT_AI_NOT_CONFIGURED");
      const { data: character } = await sb.from("characters").select("name").eq("id", item.character_id).single();
      const instruction = "Return ONLY this exact JSON object: {\"slides\":[\"Hungarian slide 1\",\"Hungarian slide 2\",\"Hungarian slide 3\"],\"caption\":\"Hungarian caption\",\"scene\":\"English concise scene description\"}. Write original, natural Hungarian story hooks and questions that invite thoughtful comments, alternating hopeful and sometimes sad emotions. Do not fabricate trends or engagement claims, and do not use engagement bait or manipulative urgency. No text embedded in images. Public content is fully clothed and suitable for social platforms.";
      const context = JSON.stringify({ model: character?.name, platform: item.platform, postingHour: item.post_hour,
        inspiration: "A supplied example uses a natural mirror selfie and a three-slide Hungarian relationship story. Produce an original variation; do not copy it.",
        visualStyle: item.platform === "tiktok" ? "Everyday candid Hungarian social photo carousel, fully clothed" :
          "Tasteful adult glamour portrait in elegant lingerie, confident pose, non-explicit",
        format: item.aspect_ratio });
      let copy: z.infer<typeof Copy>;
      const first = await generateContentJson<unknown>(instruction, context);
      const parsed = Copy.safeParse(first);
      if (parsed.success) copy = parsed.data;
      else copy = Copy.parse(await generateContentJson<unknown>(instruction,
        `${context}\nThe previous response omitted required fields. Return exactly slides (array of three strings), caption (string), scene (string).`));
      const jobIds: string[] = [];
      for (let slide = 0; slide < slideCount; slide++) {
        const { data: selected, error: sourceError } = await sb.rpc("reserve_content_source", {
          p_owner: item.owner_id, p_item: item.id, p_pool: pool, p_slide: slide, p_revision: item.regeneration_count ?? 0,
        });
        if (sourceError) throw sourceError;
        const assetId = selected?.[0]?.asset_id;
        if (!assetId) throw new Error(`NO_UNUSED_${pool.toUpperCase()}_SOURCE`);
        const prepared = await prepareValidatedJobInput({ userId: item.owner_id, type: "character_swap",
          characterId: item.character_id, payload: { sourceAssetId: assetId, useCharacterReference: true,
            editModel: "seedream-v4.5", contentAspectRatio: item.aspect_ratio } });
        if (prepared.error) throw new Error(prepared.error);
        const estimate = await buildRouter().estimate("character_swap", prepared.payload);
        const key = `content:${item.id}:${item.regeneration_count ?? 0}:${slide}`;
        const { data: existing } = await sb.from("generation_jobs").select("id").eq("idempotency_key", key).maybeSingle();
        const jobId = existing?.id ?? await createJobWithHold({ userId: item.owner_id, type: "character_swap",
          characterId: item.character_id, payload: prepared.payload, idempotencyKey: key, costEstimate: estimate.credits });
        jobIds.push(jobId);
        // Persist progress before the next provider submission, so partial failures remain visible.
        const { error: progressError } = await sb.from("model_content_items").update({ copy, image_jobs: jobIds }).eq("id", item.id);
        if (progressError) throw progressError;
        scheduleKick(jobId);
      }
      const { error: saveError } = await sb.from("model_content_items")
        .update({ copy, image_jobs: jobIds }).eq("id", item.id);
      if (saveError) throw saveError;
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
  const { data: items, error } = await sb.from("model_content_items").select("id,image_jobs")
    .eq("status", "generating").limit(40);
  if (error) throw error;
  for (const item of items ?? []) {
    const jobIds = item.image_jobs ?? [];
    if (!jobIds.length) continue;
    const { data: jobs } = await sb.from("generation_jobs").select("id,status,error").in("id", jobIds);
    const failed = jobs?.find(j => j.status === "failed" || j.status === "cancelled");
    if (failed) await sb.from("model_content_items").update({ status: "failed", error: failed.error ?? failed.status }).eq("id", item.id);
    else if (jobs && jobs.length === jobIds.length && jobs.every(j => j.status === "completed"))
      await sb.from("model_content_items").update({ status: "ready" }).eq("id", item.id);
  }
}
