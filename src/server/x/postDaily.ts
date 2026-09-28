import "server-only";
import sharp from "sharp";
import { serviceClient } from "@/lib/supabase/server";
import { decrypt, encrypt, refreshToken, xConfigured, xUploadAndPost } from "./client";

type Connection = { id: string; owner_id: string; character_id: string; x_username: string;
  encrypted_access_token: string; encrypted_refresh_token: string; token_expires_at: string;
  timezone: string };

function localTime(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric",
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (key: string) => parts.find(p => p.type === key)?.value ?? "";
  return { date: `${part("year")}-${part("month")}-${part("day")}`,
    minute: Number(part("hour")) * 60 + Number(part("minute")) };
}

// Budapest local time. The cron runs once a minute; a short grace window
// handles a delayed invocation without sending two neighboring slots together.
const schedule = [
  { slot: "06:13", minute: 373, questions: ["Jó reggelt! Ki kelt már fel? ☀️", "Korán kelő vagy, vagy inkább éjjeli bagoly? ☀️", "Mivel indul nálad a reggel? ☕"] },
  { slot: "08:37", minute: 517, questions: ["Milyen a mai szettem? 🤍", "Te mit vennél fel ma? ✨", "Ez a szett maradhat? 🤍"] },
  { slot: "10:23", minute: 623, questions: ["Ki merre jár ma? 🌸", "Honnan nézed most ezt a képet? 📍", "Ma dolgozol vagy pihensz? 💫"] },
  { slot: "12:03", minute: 723, questions: ["Mit ebédelsz ma? 😋", "Nálad mi lesz ma az ebéd? 🍽️", "Édes vagy sós ebéd után? 🤍"] },
  { slot: "14:46", minute: 886, questions: ["Hány évesnek tippelsz? Most te jössz. 😉", "Szerinted hány éves vagyok? 🤭", "Mennyi idősnek nézek ki ezen a képen? 💫"] },
  { slot: "17:06", minute: 1026, questions: ["Jársz edzeni? 💪", "Te mivel kapcsolódsz ki munka után? ✨", "Edzés vagy inkább egy hosszú séta? 🤍"] },
  { slot: "19:38", minute: 1178, questions: ["Milyen volt a napod? 🌙", "Mi volt ma a legjobb pillanatod? ✨", "Ma este ki merre van? 🌙"] },
  { slot: "20:49", minute: 1249, questions: ["Ez a kép tetszik? 🖤", "Melyik szín állna nekem a legjobban? 🤍", "Milyen képet látnál tőlem legközelebb? ✨"] },
  { slot: "22:58", minute: 1378, questions: ["Ki van még fent? 🌙", "Ilyenkor még ébren vagy? 👀", "Éjjeli bagoly vagy? 🌙"] },
  { slot: "23:29", minute: 1409, questions: ["Mi az utolsó gondolatod lefekvés előtt? 🌙", "Jó éjt, vagy még beszélgetünk? 🤍", "Mit tervezel holnapra? ✨"] },
] as const;

export async function postDailyX(now = new Date()) {
  if (!xConfigured()) return { posted: 0, skipped: "X_APP_NOT_CONFIGURED" };
  const sb = serviceClient();
  const { data: accounts, error } = await sb.from("x_social_connections")
    .select("id,owner_id,character_id,x_username,encrypted_access_token,encrypted_refresh_token,token_expires_at,timezone")
    .eq("enabled", true).limit(20);
  if (error) throw new Error(`X_CONNECTIONS_${error.code}`);
  let posted = 0;
  for (const account of (accounts ?? []) as Connection[]) {
    let local: ReturnType<typeof localTime>;
    try { local = localTime(now, account.timezone); }
    catch { console.error("x.schedule.invalid_timezone", account.id); continue; }
    for (const item of schedule) {
      const slot = item.slot;
      if (local.minute < item.minute || local.minute >= item.minute + 10) continue;
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
          .order("created_at", { ascending: false }).limit(2000);
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
          const seed = Number(local.date.replaceAll("-", "")) + [...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
          const question = item.questions[seed % item.questions.length];
          const id = await xUploadAndPost(access, jpeg, `${question}\n\n${fanvueLink}`);
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
