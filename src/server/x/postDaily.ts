import "server-only";
import sharp from "sharp";
import { serviceClient } from "@/lib/supabase/server";
import { decrypt, encrypt, refreshToken, xConfigured, xUploadAndPost } from "./client";

type Connection = { id: string; owner_id: string; character_id: string; x_username: string;
  encrypted_access_token: string; encrypted_refresh_token: string; token_expires_at: string;
  timezone: string; morning_minute: number; evening_minute: number };

function localTime(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric",
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (key: string) => parts.find(p => p.type === key)?.value ?? "";
  return { date: `${part("year")}-${part("month")}-${part("day")}`,
    minute: Number(part("hour")) * 60 + Number(part("minute")) };
}

const morning = [
  "Ma vajon milyen napunk lesz? ☀️", "Reggeli fények és egy új kezdet. 🌷",
  "Kávé mellé egy mosoly? ☕", "Ma is jöhet valami váratlanul jó. ✨",
  "Induljon szépen ez a nap! 🤍", "Egy kis reggeli pillanat tőlem. ☀️",
  "Új nap, új történet. Te mivel kezded? 🌸", "Ma egy kicsit lassabban indulok. ☕",
  "Jó reggelt! Mi a mai terved? 💫", "Elcsíptem a reggeli fényt. 🌞",
];
const evening = [
  "A nap végére maradt még egy képem. 🌙", "Esti hangulat. Milyen volt a napod? ✨",
  "Ma ez a pillanat lett a kedvencem. 🤍", "Végre egy nyugodt este. 🌙",
  "Ma este egy kicsit megállok. Te is? 💫", "Egy kép lefekvés előtt. Jó éjt! 🌙",
  "Estére mindig más lesz a fény. ✨", "Ma ennyi fért bele. Holnap folytatjuk! 🌷",
  "Az esti képeknek külön hangulata van. 🤍", "Még egy pillanat a mai napból. 🌙",
];

export async function postDailyX(now = new Date()) {
  if (!xConfigured()) return { posted: 0, skipped: "X_APP_NOT_CONFIGURED" };
  const sb = serviceClient();
  const { data: accounts, error } = await sb.from("x_social_connections")
    .select("id,owner_id,character_id,x_username,encrypted_access_token,encrypted_refresh_token,token_expires_at,timezone,morning_minute,evening_minute")
    .eq("enabled", true).limit(20);
  if (error) throw new Error(`X_CONNECTIONS_${error.code}`);
  let posted = 0;
  for (const account of (accounts ?? []) as Connection[]) {
    let local: ReturnType<typeof localTime>;
    try { local = localTime(now, account.timezone); }
    catch { console.error("x.schedule.invalid_timezone", account.id); continue; }
    for (const slot of ["morning", "evening"] as const) {
      const target = slot === "morning" ? account.morning_minute : account.evening_minute;
      if (local.minute < target || local.minute >= target + 60) continue;
      try {
        const { data: profile, error: profileError } = await sb.from("model_accounts")
          .select("account_url").eq("owner_id", account.owner_id)
          .eq("character_id", account.character_id).eq("platform", "fanvue")
          .not("account_url", "is", null).limit(1).maybeSingle();
        if (profileError) throw new Error(`X_FANVUE_PROFILE_${profileError.code}`);
        let fanvueLink: string;
        try {
          const url = new URL(profile?.account_url ?? "");
          if (url.protocol !== "https:" || !["fanvue.com", "www.fanvue.com"].includes(url.hostname)
            || url.pathname === "/") throw new Error("invalid");
          fanvueLink = url.toString();
        } catch { console.error("x.schedule.fanvue_link_missing", account.id); continue; }
        const { data: prior } = await sb.from("x_social_posts").select("id")
          .eq("connection_id", account.id).eq("local_date", local.date).eq("slot", slot).maybeSingle();
        if (prior) continue;
        const { data: images, error: imageError } = await sb.from("gallery_items")
          .select("id,asset_id,assets(bucket,object_path,media_type)")
          .eq("owner_id", account.owner_id).eq("character_id", account.character_id)
          .eq("content_category", "tiktok").is("deleted_at", null)
          .not("used_at", "is", null).neq("qc_status", "rejected")
          .order("used_at", { ascending: false }).limit(500);
        if (imageError) throw new Error(`X_GALLERY_${imageError.code}`);
        const { data: postedImages, error: historyError } = await sb.from("x_social_posts")
          .select("gallery_item_id").eq("connection_id", account.id)
          .limit(2000);
        if (historyError) throw new Error(`X_HISTORY_${historyError.code}`);
        const sent = new Set((postedImages ?? []).map(p => p.gallery_item_id));
        const choice = (images ?? []).find(image => !sent.has(image.id)
          && (image.assets as unknown as { media_type?: string } | null)?.media_type === "image");
        if (!choice) continue;
        const { data: claim, error: claimError } = await sb.from("x_social_posts").insert({
          connection_id: account.id, owner_id: account.owner_id, character_id: account.character_id,
          gallery_item_id: choice.id, local_date: local.date, slot, status: "sending",
        }).select("id").maybeSingle();
        if (claimError?.code === "23505") continue;
        if (claimError) throw new Error(`X_CLAIM_${claimError.code}`);
        if (!claim) continue;
        let published = false;
        try {
          const asset = choice.assets as unknown as { bucket: string; object_path: string };
          const { data: file, error: downloadError } = await sb.storage.from(asset.bucket).download(asset.object_path);
          if (downloadError || !file) throw new Error("X_IMAGE_DOWNLOAD_FAILED");
          let jpeg = await sharp(Buffer.from(await file.arrayBuffer()))
            .rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 83 }).toBuffer();
          if (jpeg.length > 5_000_000) jpeg = await sharp(jpeg).resize({ width: 1600, height: 1600,
            fit: "inside", withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
          if (jpeg.length > 5_000_000) throw new Error("X_IMAGE_TOO_LARGE");
          let access = decrypt(account.encrypted_access_token);
          if (Date.parse(account.token_expires_at) < Date.now() + 120_000) {
            const token = await refreshToken(decrypt(account.encrypted_refresh_token));
            access = token.access_token;
            const { error: refreshError } = await sb.from("x_social_connections").update({
              encrypted_access_token: encrypt(token.access_token),
              encrypted_refresh_token: encrypt(token.refresh_token),
              token_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
              updated_at: new Date().toISOString(),
            }).eq("id", account.id);
            if (refreshError) throw new Error("X_TOKEN_SAVE_FAILED");
            account.encrypted_access_token = encrypt(access);
            account.encrypted_refresh_token = encrypt(token.refresh_token);
            account.token_expires_at = new Date(Date.now() + token.expires_in * 1000).toISOString();
          }
          const name = account.x_username;
          const captions = slot === "morning" ? morning : evening;
          const seed = Number(local.date.replaceAll("-", "")) + [...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
          const id = await xUploadAndPost(access, jpeg, `${captions[seed % captions.length]}\n— ${name}\n${fanvueLink}`);
          published = true;
          const { error: doneError } = await sb.from("x_social_posts")
            .update({ status: "posted", x_post_id: id }).eq("id", claim.id);
          if (doneError) throw new Error("X_POST_RECORD_FAILED");
          posted++;
        } catch (failure) {
          const message = failure instanceof Error ? failure.message : "X_POST_UNKNOWN";
          console.error("x.post", account.id, message);
          if (!published) await sb.from("x_social_posts")
            .update({ status: "failed", error: message.slice(0, 200) }).eq("id", claim.id);
        }
      } catch (failure) {
        console.error("x.schedule", account.id, failure instanceof Error ? failure.message : "unknown");
      }
    }
  }
  return { posted };
}
