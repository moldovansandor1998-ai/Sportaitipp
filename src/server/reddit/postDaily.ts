import "server-only";
import { createHash, randomUUID } from "crypto";
import sharp from "sharp";
import { serviceClient } from "@/lib/supabase/server";
import { questionForXImage } from "@/lib/contentAi";
import { buildRedditCopy, localRedditTime, normalizeFanvueUrl, normalizePostingMinutes, redditCopyTooSimilar } from "@/lib/redditAutomation";
import { decrypt, encrypt, redditApproved, redditConfigured, RedditApiError, redditSubreddit, redditSubmitText, refreshToken } from "./client";
import { buildRichTextPost, uploadRedditImage } from "./media";
import { classifyCommunity } from "./discovery";
import { imagePerceptualHash, similarImageHashes } from "./imageFingerprint";

type Connection = { id: string; owner_id: string; character_id: string; reddit_username: string;
  reddit_user_id: string;
  encrypted_access_token: string; encrypted_refresh_token: string; token_expires_at: string;
  timezone: string; subreddit: string | null; posting_minutes: number[]; rules_confirmed: boolean };

export async function postDailyReddit(now = new Date()) {
  if (!redditApproved() || !redditConfigured()) return { posted: 0, skipped: "REDDIT_NOT_READY" };
  const sb = serviceClient();
  const { data: accounts, error } = await sb.from("reddit_social_connections")
    .select("id,owner_id,character_id,reddit_user_id,reddit_username,encrypted_access_token,encrypted_refresh_token,token_expires_at,timezone,subreddit,posting_minutes,rules_confirmed")
    .eq("enabled", true).order("updated_at").limit(50);
  if (error) throw new Error("REDDIT_CONNECTIONS_FAILED");
  let posted = 0, attempted = 0;
  for (const account of (accounts ?? []) as Connection[]) {
    if (attempted >= 3) break; // The independent five-minute cron remains within its runtime budget.
    let claimId: string | null = null, lockToken: string | null = null, submitStarted = false, published = false;
    try {
      if (!account.subreddit || !account.rules_confirmed) continue;
      const { data: unresolved, error: unresolvedError } = await sb.from("reddit_social_posts")
        .select("id").eq("owner_id", account.owner_id).eq("reddit_user_id", account.reddit_user_id)
        .or(`status.eq.uncertain,and(status.eq.sending,created_at.lt.${new Date(now.getTime() - 600_000).toISOString()})`).limit(1);
      if (unresolvedError) throw new Error("REDDIT_HISTORY_FAILED");
      if (unresolved?.length) {
        const paused = await sb.from("reddit_social_connections").update({ enabled: false,
          pause_reason: "REDDIT_SUBMIT_OUTCOME_UNKNOWN" }).eq("id", account.id);
        if (paused.error) throw new Error("REDDIT_PAUSE_FAILED");
        continue;
      }
      const local = localRedditTime(now, account.timezone);
      const minute = normalizePostingMinutes(account.posting_minutes).find(slot => local.minute >= slot && local.minute < slot + 15);
      if (minute === undefined) continue; // Never backfill missed slots or burst several old posts.
      const slot = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
      const { data: prior, error: priorError } = await sb.from("reddit_social_posts").select("id")
        .eq("connection_id", account.id).eq("local_date", local.date).eq("slot", slot).maybeSingle();
      if (priorError) throw new Error("REDDIT_HISTORY_FAILED");
      if (prior) continue;
      // Serialize publishing per owner, including different models/destinations.
      // This closes the gap between perceptual duplicate lookup and reservation.
      const token = randomUUID(), expiresAt = new Date(Date.now() + 600_000).toISOString();
      const recoveredLock = await sb.from("reddit_publishing_locks").update({ lease_token: token, expires_at: expiresAt })
        .eq("owner_id", account.owner_id).lt("expires_at", new Date().toISOString()).select("owner_id").maybeSingle();
      if (recoveredLock.error) throw new Error("REDDIT_LOCK_FAILED");
      if (!recoveredLock.data) {
        const newLock = await sb.from("reddit_publishing_locks").insert({ owner_id: account.owner_id,
          lease_token: token, expires_at: expiresAt }).select("owner_id").maybeSingle();
        if (newLock.error?.code === "23505") continue;
        if (newLock.error || !newLock.data) throw new Error("REDDIT_LOCK_FAILED");
      }
      lockToken = token;
      const lockedHistory = await sb.from("reddit_social_posts").select("id")
        .eq("owner_id", account.owner_id).eq("reddit_user_id", account.reddit_user_id)
        .or(`status.eq.uncertain,and(status.eq.sending,created_at.lt.${new Date(Date.now() - 600_000).toISOString()})`).limit(1);
      if (lockedHistory.error) throw new Error("REDDIT_HISTORY_FAILED");
      if (lockedHistory.data?.length) throw new RedditApiError("REDDIT_SUBMIT_OUTCOME_UNKNOWN", true);
      const { data: claim, error: claimError } = await sb.from("reddit_social_posts").insert({
        connection_id: account.id, owner_id: account.owner_id, character_id: account.character_id,
        reddit_user_id: account.reddit_user_id,
        subreddit: account.subreddit, local_date: local.date, slot, status: "preparing",
      }).select("id").maybeSingle();
      if (claimError?.code === "23505") continue;
      if (claimError || !claim) throw new Error("REDDIT_CLAIM_FAILED");
      claimId = claim.id; attempted++;
      const pause = async (reason: string) => {
        const result = await sb.from("reddit_social_connections").update({ enabled: false, pause_reason: reason,
          updated_at: new Date().toISOString() }).eq("id", account.id);
        if (result.error) throw new Error("REDDIT_PAUSE_FAILED");
      };
      const [model, profiles, history] = await Promise.all([
        sb.from("characters").select("name,status").eq("id", account.character_id).eq("owner_id", account.owner_id).maybeSingle(),
        sb.from("model_accounts").select("account_url").eq("owner_id", account.owner_id)
          .eq("character_id", account.character_id).eq("platform", "fanvue").limit(10),
        sb.from("reddit_social_posts").select("caption,image_sha256,image_phash,gallery_item_id").eq("owner_id", account.owner_id)
          .not("image_sha256", "is", null).order("created_at", { ascending: false }).limit(2000),
      ]);
      if (model.error || !model.data || model.data.status !== "active") throw new Error("REDDIT_MODEL_NOT_ACTIVE");
      if (profiles.error || history.error) throw new Error("REDDIT_SOURCE_LOOKUP_FAILED");
      let fanvueUrl = "";
      for (const profile of profiles.data ?? []) {
        try { fanvueUrl = normalizeFanvueUrl(profile.account_url); break; } catch { /* Try another explicit model profile. */ }
      }
      if (!fanvueUrl) { await pause("REDDIT_FANVUE_LINK_REQUIRED"); throw new Error("REDDIT_FANVUE_LINK_REQUIRED"); }
      let access = decrypt(account.encrypted_access_token);
      if (!Number.isFinite(Date.parse(account.token_expires_at)) || Date.parse(account.token_expires_at) < Date.now() + 120_000) {
        const token = await refreshToken(decrypt(account.encrypted_refresh_token));
        access = token.access_token;
        const saved = await sb.from("reddit_social_connections").update({ encrypted_access_token: encrypt(access),
          ...(token.refresh_token && { encrypted_refresh_token: encrypt(token.refresh_token) }),
          token_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString() }).eq("id", account.id);
        if (saved.error) throw new Error("REDDIT_TOKEN_SAVE_FAILED");
      }
      // Re-read community state at publication time; a user confirmation is not a waiver of its rules.
      const community = await redditSubreddit(access, account.subreddit);
      const ruleVerdict = classifyCommunity(community, community.rules,
        community.restricted || community.quarantined || community.submissionType === "link");
      if (ruleVerdict.status === "blocked") {
        await pause("REDDIT_COMMUNITY_UNAVAILABLE"); throw new Error("REDDIT_COMMUNITY_UNAVAILABLE");
      }
      const rulesFingerprint = createHash("sha256").update(JSON.stringify(community.rules)).digest("hex");
      const { data: ruleState, error: ruleError } = await sb.from("reddit_social_connections")
        .select("rules_fingerprint").eq("id", account.id).maybeSingle();
      if (ruleError) throw new Error("REDDIT_RULES_LOOKUP_FAILED");
      if (ruleState?.rules_fingerprint && ruleState.rules_fingerprint !== rulesFingerprint) {
        await sb.from("reddit_social_connections").update({ rules_confirmed: false }).eq("id", account.id);
        await pause("REDDIT_RULES_CHANGED_REVIEW_REQUIRED"); throw new Error("REDDIT_RULES_CHANGED_REVIEW_REQUIRED");
      }
      if (!ruleState?.rules_fingerprint) {
        const saved = await sb.from("reddit_social_connections").update({ rules_fingerprint: rulesFingerprint }).eq("id", account.id);
        if (saved.error) throw new Error("REDDIT_RULES_SAVE_FAILED");
      }
      const { data: images, error: imagesError } = await sb.from("gallery_items")
        .select("id,asset_id,assets(bucket,object_path,media_type)").eq("owner_id", account.owner_id)
        .eq("character_id", account.character_id).eq("content_category", "tiktok")
        .is("deleted_at", null).not("used_at", "is", null).neq("qc_status", "rejected")
        .order("used_at", { ascending: false }).limit(300);
      if (imagesError) throw new Error("REDDIT_GALLERY_FAILED");
      const previousHashes = new Set((history.data ?? []).map(post => post.image_sha256));
      const usedGallery = new Set((history.data ?? []).map(post => post.gallery_item_id));
      const previousPerceptual = (history.data ?? []).map(post => post.image_phash).filter((value): value is string => typeof value === "string");
      let jpeg: Buffer | undefined, imageId: string | undefined, imageHash: string | undefined, perceptualHash: string | undefined;
      for (const image of (images ?? []).filter(image => !usedGallery.has(image.id)).slice(0, 12)) {
        const asset = image.assets as unknown as { bucket: string; object_path: string; media_type: string } | null;
        if (!asset || asset.media_type !== "image") continue;
        const { data: file, error: downloadError } = await sb.storage.from(asset.bucket).download(asset.object_path);
        if (downloadError || !file) continue;
        if (file.size > 20_000_000) continue;
        const bytes = Buffer.from(await file.arrayBuffer());
        const hash = createHash("sha256").update(bytes).digest("hex");
        if (previousHashes.has(hash)) continue;
        const phash = await imagePerceptualHash(bytes);
        if (previousPerceptual.some(previous => similarImageHashes(phash, previous))) continue;
        jpeg = await sharp(bytes).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 80 }).toBuffer();
        if (jpeg.length > 5_000_000) continue;
        imageId = image.id; imageHash = hash; perceptualHash = phash; break;
      }
      if (!jpeg || !imageId || !imageHash) throw new Error("REDDIT_NO_UNUSED_PUBLIC_IMAGE");
      const recentCaptions = (history.data ?? []).map(post => post.caption).filter((value): value is string => typeof value === "string");
      const preview = await sharp(jpeg).resize({ width: 640, height: 640, fit: "inside" }).jpeg({ quality: 65 }).toBuffer();
      let caption = "";
      for (let i = 0; i < 2; i++) {
        const generated = await questionForXImage(preview, model.data.name, slot, recentCaptions,
          "a natural photo observation for a Reddit community; no vote, repost, dating, sexual solicitation or age questions");
        if (!redditCopyTooSimilar(generated.question, recentCaptions)) { caption = generated.question; break; }
      }
      if (!caption) throw new Error("REDDIT_NO_DISTINCT_CAPTION");
      const copy = buildRedditCopy(caption, model.data.name, fanvueUrl);
      const prepared = await sb.from("reddit_social_posts").update({ gallery_item_id: imageId, image_sha256: imageHash, image_phash: perceptualHash,
        caption, fanvue_url: fanvueUrl, title: copy.title }).eq("id", claimId);
      if (prepared.error) throw new Error(prepared.error.code === "23505" ? "REDDIT_DUPLICATE_IMAGE" : "REDDIT_PREPARE_SAVE_FAILED");
      const media = await uploadRedditImage(access, jpeg);
      // Check pause/disconnect and changed destination again after slow image/caption preparation.
      const { data: fresh, error: freshError } = await sb.from("reddit_social_connections")
        .select("enabled,subreddit,rules_confirmed").eq("id", account.id).maybeSingle();
      if (freshError || !fresh?.enabled || !fresh.rules_confirmed || fresh.subreddit !== account.subreddit)
        throw new Error("REDDIT_SETTINGS_CHANGED");
      const { data: lease, error: leaseError } = await sb.from("reddit_publishing_locks").select("owner_id")
        .eq("owner_id", account.owner_id).eq("lease_token", lockToken).gt("expires_at", new Date(Date.now() + 60_000).toISOString()).maybeSingle();
      if (leaseError || !lease) throw new Error("REDDIT_PUBLISH_LEASE_EXPIRED");
      const sending = await sb.from("reddit_social_posts").update({ status: "sending" }).eq("id", claimId).eq("status", "preparing")
        .select("id").maybeSingle();
      if (sending.error || !sending.data) throw new Error("REDDIT_SEND_RECORD_FAILED");
      submitStarted = true;
      const result = await redditSubmitText(access, { subreddit: account.subreddit, title: copy.title, text: copy.text,
        richtext: JSON.stringify(buildRichTextPost({ assetId: media.assetId, caption, fanvueUrl, modelName: model.data.name })), nsfw: community.over18 });
      published = true;
      const recorded = await sb.from("reddit_social_posts").update({ status: "posted", reddit_post_id: result.id,
        permalink: result.permalink, posted_at: new Date().toISOString() }).eq("id", claimId);
      if (recorded.error) throw new Error("REDDIT_POST_RECORD_FAILED");
      posted++;
    } catch (failure) {
      const code = failure instanceof Error ? failure.message.slice(0, 160) : "REDDIT_UNKNOWN_ERROR";
      const ambiguous = published || (failure instanceof RedditApiError && failure.ambiguous)
        || (submitStarted && !(failure instanceof RedditApiError));
      if (claimId) {
        const result = await sb.from("reddit_social_posts").update({ status: ambiguous ? "uncertain" : "failed", error: code }).eq("id", claimId);
        if (result.error) console.error("reddit.record", account.id, "REDDIT_FAILURE_RECORD_FAILED");
      }
      if (ambiguous || /REDDIT_(?:HTTP_(?:401|403|429)|RATELIMIT|USER_REQUIRED|SUBREDDIT_NOTALLOWED|SUBREDDIT_NOEXIST|SUBREDDIT_NOT_ALLOWED|INVALID_GRANT)/.test(code)) {
        await sb.from("reddit_social_connections").update({ enabled: false,
          pause_reason: ambiguous ? "REDDIT_SUBMIT_OUTCOME_UNKNOWN" : code, updated_at: new Date().toISOString() }).eq("id", account.id);
      }
      console.error("reddit.schedule", account.id, code);
    } finally {
      if (lockToken) {
        const released = await sb.from("reddit_publishing_locks").delete().eq("owner_id", account.owner_id).eq("lease_token", lockToken);
        if (released.error) console.error("reddit.lease.release", account.id, "REDDIT_LOCK_RELEASE_FAILED");
      }
    }
  }
  return { posted, attempted };
}
