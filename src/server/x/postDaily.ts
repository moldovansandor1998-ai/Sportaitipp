import "server-only";
import sharp from "sharp";
import { serviceClient } from "@/lib/supabase/server";
import { questionForXImage } from "@/lib/contentAi";
import { decrypt, encrypt, refreshToken, xConfigured, xUploadAndPost } from "./client";

type Connection = { id: string; owner_id: string; character_id: string; x_username: string;
  encrypted_access_token: string; encrypted_refresh_token: string; token_expires_at: string;
  timezone: string; test_requested_at: string | null };

const captionAngles = ["playful observation", "lightly flirtatious statement", "one-word comment prompt",
  "unexpected detail", "cheeky but tasteful question", "short confident statement",
  "mood and atmosphere", "gentle tease", "choose the next photo mood", "warm late-night thought"] as const;

const fallbackCaptions = [
  "Na jó, erre a képre kíváncsi vagyok, mit mondasz. 👀",
  "A részletek néha többet mondanak, mint egy hosszú bemutatkozás. 😉",
  "Van egy tippem, mi tűnt fel neked először… de írd meg te. 😏",
  "Ezt a hangulatot megtartanád, vagy jöjjön valami merészebb? ✨",
  "Egy szóban milyen ez a kép? Kíváncsi vagyok a válaszodra. 🤍",
  "Most te jössz: egy bók vagy egy őszinte vélemény? 😌",
  "Kicsit ártatlan, kicsit huncut. Te melyiknek látod? 😉",
  "Nem írok hozzá hosszú szöveget. A reakciódat viszont megnézem. 👀",
  "Szerintem a szemkontaktus néha elég. Te mit szólsz? ✨",
  "Erre a pillanatra mondanál egy jó címet? 😏",
  "Ma ezt a hangulatot hoztam. Maradhat? 🤍",
  "Vajon ugyanazt vetted észre a képen, amit én? 👀",
  "Ha most itt lennél, mivel indítanád a beszélgetést? 😉",
  "Hagytam egy kis teret a fantáziádnak. 😌",
  "Egyszerű pillanat, de szerintem van benne valami. ✨",
  "Mondj egy számot 1 és 10 között, és nem sértődöm meg. 😏",
  "Van, amikor a képhez tényleg nem kell magyarázat. 🤍",
  "Ezt inkább egy mosollyal vagy egy kommenttel fogadnád? 😉",
  "Kíváncsi vagyok, milyen történetet képzelsz ehhez a fotóhoz. 👀",
  "Ha ez lenne az első kép, amit rólam látsz, mit gondolnál? ✨",
];

function captionWords(value: string) {
  return new Set(value.toLocaleLowerCase("hu-HU").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/).filter(word => word.length > 3));
}

function tooSimilar(candidate: string, previous: string[]) {
  const words = captionWords(candidate);
  const normalized = candidate.toLocaleLowerCase("hu-HU").replace(/[^\p{L}\p{N}]/gu, "");
  return previous.some(text => {
    if (text.toLocaleLowerCase("hu-HU").replace(/[^\p{L}\p{N}]/gu, "") === normalized) return true;
    const other = captionWords(text);
    const overlap = [...words].filter(word => other.has(word)).length;
    return overlap >= 3 && overlap / Math.min(words.size || 1, other.size || 1) >= 0.65;
  });
}

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
  { slot: "06:13", minute: 373 }, { slot: "08:37", minute: 517 },
  { slot: "10:23", minute: 623 }, { slot: "12:03", minute: 723 },
  { slot: "14:46", minute: 886 }, { slot: "17:06", minute: 1026 },
  { slot: "19:38", minute: 1178 }, { slot: "20:49", minute: 1249 },
  { slot: "22:58", minute: 1378 }, { slot: "23:29", minute: 1409 },
] as const;

// Each model has its own wording at every slot. No question string is shared
// across models; rotate variants by date without claiming a specific age.
export const questionsByModel: Record<string, readonly (readonly string[])[]> = {
  Dorina: [
    ["Te milyen reggellel indítod a napot? ☀️", "Mi ébresztett fel ma először? ✨"],
    ["Melyik része tetszik a mai szettemnek? 🤎", "Ezt a stílust választanád nekem? 👀"],
    ["Hová mennél ma szívesen? 📍", "Milyen programot választanál mára? 🌿"],
    ["Melyik apró részletet vetted észre először? ✨", "Mit néztél meg először ezen a fotón? 🤎"],
    ["Milyen hangulatot ad neked ez a kép? 🌸", "Egy szóval hogyan írnád le ezt a pillanatot? 💭"],
    ["Milyen szín áll szerinted a legjobban? 🎨", "Te melyik színt választanád nekem? 🤎"],
    ["Mi dobta fel ma a délutánodat? 🌼", "Nálad mivel telt a délután? ✨"],
    ["Mi ragadta meg a figyelmed a képen? 👀", "Melyik részlet maradt meg benned ebből a fotóból? 🌿"],
    ["Ki tart még velem ma este? 🌙", "Milyen napod volt ma? 💬"],
    ["Milyen képet látnál szívesen holnap? 🤎", "Mit tervezel a holnapi napra? ✨"],
  ],
  Dorika: [
    ["Felébredtél már, vagy még öt perc szundi? ☀️", "Reggeli kávé vagy még visszabújnál? ☕"],
    ["Passzol hozzám ez a mai szett? 🤍", "Ezt a ruhát választanád nekem? ✨"],
    ["Ma merre visz az utad? 📍", "Te melyik városból írsz most? 🌸"],
    ["Ebédszünetben rám nézel? 😋", "Mi finom készül nálad délben? 🍽️"],
    ["Szerinted hány évesnek nézek ki? 🤭", "Mennyinek tippelnél első ránézésre? 😉"],
    ["Te ma edzel, vagy kihagyod? 💪", "Mivel töltöd a délutánod? ✨"],
    ["Mesélsz egy jó dolgot a mai napodból? 🌙", "Nálad hogy telt a nap? 🤍"],
    ["Melyik részlet tetszik legjobban a képen? 🖤", "Milyen színben látnál szívesen? 💫"],
    ["Ki beszélgetne még egy kicsit? 👀", "Rajtam kívül ki nem alszik még? 🌙"],
    ["Holnap reggel korán kelsz? 🌙", "Mi az első terved holnapra? 🤍"],
  ],
  Laura: [
    ["Te hánykor szoktál felkelni? ☀️", "Reggel edzés vagy lustálkodás? 💪"],
    ["Hogy áll rajtam ez az összeállítás? 🖤", "Melyik cipőt vennéd fel ehhez? 👟"],
    ["Most éppen úton vagy valahová? 📍", "Munka, suli vagy szabadnap nálad? ✨"],
    ["Nálad mi a kedvenc gyors ebéd? 😋", "Ebéd után jöhet egy kávé? ☕"],
    ["Mit tippelsz, mennyi idős lehetek? 😉", "Ránézésre hány évesnek mondanál? 🤍"],
    ["Hányszor mozogsz egy héten? 💪", "Edzőterem vagy szabadtéri mozgás? 🏃‍♀️"],
    ["Mi töltött fel ma a legjobban? 🌆", "Volt ma időd magadra? ✨"],
    ["Ebből a képből mi fogott meg először? 👀", "Jöhetne még ilyen hangulatú fotó? 🖤"],
    ["Késő esti edzés vagy már pihenés? 🌙", "Ki van még ébren egy gyors beszélgetésre? 💬"],
    ["Milyen célod van holnapra? ✨", "Lefekvés előtt még mit csinálsz? 🌙"],
  ],
  Petra: [
    ["Ébresztő! Te már talpon vagy? 🔥", "Ki nyomta ma túl sokszor a szundit? 😉"],
    ["Őszintén: túl merész ez a szett? 🖤", "Ez a ruha maradjon, vagy váltsak? 🔥"],
    ["Hol kaplak el ma egy kávéra? ☕", "Te most otthon vagy, vagy úton? 📍"],
    ["Mit rendeljünk ebédre? 😏", "Csípős vagy édes? Válassz nekem! 🍽️"],
    ["Meg tudod tippelni a koromat? 👀", "Hány évet adnál nekem ezen a fotón? 😘"],
    ["Bevállalnál velem egy edzést? 💪", "Délután mozgás vagy inkább lazítás? 🔥"],
    ["Mi volt ma a legjobb döntésed? ✨", "Este program vagy bekuckózás? 🖤"],
    ["Ez a fotó jöhet még egyszer más pózban? 😏", "Melyik képet mutassam meg legközelebb? 👀"],
    ["Még itt vagy velem? 🌙", "Ki válaszolna ilyenkor is? 🔥"],
    ["Jó éjt kívánjak, vagy még maradsz? 🖤", "Mit álmodnál ma szívesen? 🌙"],
  ],
  "Zsófia": [
    ["Milyen reggelre ébredtél ma? 🌷", "Mi segít neked szépen indítani a napot? ☀️"],
    ["Szerinted jól választottam ma ruhát? 🤍", "Ez a szín szerinted illik hozzám? 🌸"],
    ["Nálatok milyen az idő ma? ☁️", "Messziről írsz, vagy a közelből? 📍"],
    ["Mi a kedvenc ebéded hétköznap? 🍽️", "Te mit ennél most legszívesebben? 😋"],
    ["Mennyinek saccolnál ezen a képen? 🌸", "Kíváncsi vagyok: hány évesnek gondolsz? 🤍"],
    ["Mi a kedvenc délutáni programod? ✨", "Séta vagy egy csendes kávézás? ☕"],
    ["Mi mosolyogtatott meg ma? 🌷", "Milyen apró öröm ért ma téged? 🤍"],
    ["Melyik hangulat áll nekem jobban? ✨", "Inkább mosolygós vagy komoly képet látnál? 🌸"],
    ["Nálad mikor kezdődik az esti nyugalom? 🌙", "Te is szeretsz még ilyenkor beszélgetni? 🤍"],
    ["Mivel zárnád szépen ezt a napot? 🌙", "Mi az, amit holnap nagyon vársz? ✨"],
  ],
};

export async function postDailyX(now = new Date()) {
  if (!xConfigured()) return { posted: 0, skipped: "X_APP_NOT_CONFIGURED" };
  const sb = serviceClient();
  const { data: accounts, error } = await sb.from("x_social_connections")
    .select("id,owner_id,character_id,x_username,encrypted_access_token,encrypted_refresh_token,token_expires_at,timezone,test_requested_at")
    .eq("enabled", true).limit(20);
  if (error) throw new Error(`X_CONNECTIONS_${error.code}`);
  let posted = 0;
  for (const account of (accounts ?? []) as Connection[]) {
    let local: ReturnType<typeof localTime>;
    try { local = localTime(now, account.timezone); }
    catch { console.error("x.schedule.invalid_timezone", account.id); continue; }
    const testPending = account.test_requested_at !== null
      && Date.now() - Date.parse(account.test_requested_at) >= 0
      && Date.now() - Date.parse(account.test_requested_at) < 15 * 60_000;
    const due = [
      ...schedule.map((item, index) => ({ ...item, index }))
        .filter(item => local.minute >= item.minute && local.minute < item.minute + 10),
      ...(testPending ? [{ slot: "test", minute: local.minute, index: 3 }] : []),
    ];
    for (const item of due) {
      const slot = item.slot;
      try {
        if (slot === "test") {
          const { error: clearError } = await sb.from("x_social_connections")
            .update({ test_requested_at: null }).eq("id", account.id)
            .eq("test_requested_at", account.test_requested_at);
          if (clearError) throw new Error("X_TEST_REQUEST_CLEAR_FAILED");
        }
        const { data: character, error: characterError } = await sb.from("characters")
          .select("name").eq("id", account.character_id).eq("owner_id", account.owner_id).maybeSingle();
        if (characterError || !character) throw new Error("X_MODEL_LOOKUP_FAILED");
        const questions = questionsByModel[character.name]?.[item.index];
        if (!questions?.length) { console.error("x.schedule.questions_missing", account.id); continue; }
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
          .select("gallery_item_id,error").eq("connection_id", account.id)
          .order("created_at", { ascending: false }).limit(2000);
        if (historyError) throw new Error(`X_HISTORY_${historyError.code}`);
        // A 402 response confirms X did not publish; release that photo.
        // Preserve all other claims because a network error may be ambiguous.
        const sent = new Set((postedImages ?? []).filter(p => p.error !== "X_POST_402")
          .map(p => p.gallery_item_id));
        // Download before claiming the slot. A missing or temporarily unavailable
        // object must not consume the scheduled post or block the next cron run.
        let choice: (typeof images)[number] | undefined;
        let jpeg: Buffer | undefined;
        for (const image of (images ?? []).filter(image => !sent.has(image.id)
          && (image.assets as unknown as { media_type?: string } | null)?.media_type === "image").slice(0, 8)) {
          const asset = image.assets as unknown as { bucket: string; object_path: string };
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const { data: file, error: downloadError } = await sb.storage.from(asset.bucket).download(asset.object_path);
              if (downloadError || !file) throw new Error(downloadError?.message ?? "empty file");
              jpeg = await sharp(Buffer.from(await file.arrayBuffer()))
                .rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
                .jpeg({ quality: 83 }).toBuffer();
              if (jpeg.length > 5_000_000) jpeg = await sharp(jpeg).resize({ width: 1600, height: 1600,
                fit: "inside", withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
              if (jpeg.length > 5_000_000) throw new Error("X_IMAGE_TOO_LARGE");
              choice = image;
              break;
            } catch (downloadError) {
              console.error("x.image.download", account.id, image.id, attempt + 1,
                downloadError instanceof Error ? downloadError.message : "unknown");
              if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
            }
          }
          if (choice) break;
        }
        if (!choice || !jpeg) continue;
        const { data: claim, error: claimError } = await sb.from("x_social_posts").insert({
          connection_id: account.id, owner_id: account.owner_id, character_id: account.character_id,
          gallery_item_id: choice.id, local_date: local.date, slot, status: "sending",
        }).select("id").maybeSingle();
        if (claimError?.code === "23505") continue;
        if (claimError) throw new Error(`X_CLAIM_${claimError.code}`);
        if (!claim) continue;
        let published = false;
        try {
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
          const { data: recentPosts, error: captionsError } = await sb.from("x_social_posts")
            .select("caption").eq("owner_id", account.owner_id).eq("status", "posted")
            .not("caption", "is", null).order("created_at", { ascending: false }).limit(80);
          if (captionsError) throw new Error(`X_CAPTION_HISTORY_${captionsError.code}`);
          const recentCaptions = (recentPosts ?? []).map(post => post.caption).filter((text): text is string => !!text);
          let question = "";
          let hashtags: string[] = [];
          const preview = await sharp(jpeg).resize({ width: 640, height: 640, fit: "inside" })
            .jpeg({ quality: 65 }).toBuffer();
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const generated = await questionForXImage(preview, character.name, slot, recentCaptions,
                captionAngles[(seed + item.index + attempt * 3) % captionAngles.length]);
              if (tooSimilar(generated.question, recentCaptions)) continue;
              question = generated.question; hashtags = generated.hashtags;
              break;
            } catch (captionError) {
              console.error("x.caption.fallback", account.id,
                captionError instanceof Error ? captionError.message : "unknown");
              break;
            }
          }
          if (!question) {
            question = fallbackCaptions.map((_, index) => fallbackCaptions[(seed + item.index + index) % fallbackCaptions.length])
              .find(text => !tooSimilar(text, recentCaptions)) ?? fallbackCaptions[(seed + item.index) % fallbackCaptions.length];
          }
          const copy = [question, slot === "20:49" ? fanvueLink : "", hashtags.join(" ")]
            .filter(Boolean).join("\n\n");
          const id = await xUploadAndPost(access, jpeg, copy);
          published = true;
          const { error: doneError } = await sb.from("x_social_posts")
            .update({ status: "posted", x_post_id: id, caption: question }).eq("id", claim.id);
          if (doneError) throw new Error("X_POST_RECORD_FAILED");
          posted++;
        } catch (failure) {
          const message = failure instanceof Error ? failure.message : "X_POST_UNKNOWN";
          console.error("x.post", account.id, message);
          if (!published) await sb.from("x_social_posts")
            .update({ status: "failed", error: message.slice(0, 200) }).eq("id", claim.id);
          if (message === "X_POST_402") await sb.from("x_social_connections")
            .update({ enabled: false, updated_at: new Date().toISOString() }).eq("id", account.id);
        }
      } catch (failure) {
        console.error("x.schedule", account.id, failure instanceof Error ? failure.message : "unknown");
      }
    }
  }
  return { posted };
}
