import "server-only";
import { serviceClient } from "@/lib/supabase/server";
import { generateContentJson } from "@/lib/contentAi";
import { decrypt, encrypt, refreshToken } from "./client";
import { looksHungarian } from "./hungarianText";

type Connection = { id: string; owner_id: string; character_id: string; x_username: string;
  encrypted_access_token: string; encrypted_refresh_token: string; token_expires_at: string };
type Post = { id: string; author_id: string; text: string; lang?: string; created_at: string;
  possibly_sensitive?: boolean; public_metrics?: { like_count?: number; reply_count?: number;
    repost_count?: number; impression_count?: number } };

export async function accessFor(connection: Connection) {
  if (Date.parse(connection.token_expires_at) >= Date.now() + 120_000) return decrypt(connection.encrypted_access_token);
  const refreshed = await refreshToken(decrypt(connection.encrypted_refresh_token));
  const expires = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  const { error } = await serviceClient().from("x_social_connections").update({
    encrypted_access_token: encrypt(refreshed.access_token),
    encrypted_refresh_token: encrypt(refreshed.refresh_token), token_expires_at: expires,
    updated_at: new Date().toISOString(),
  }).eq("id", connection.id).eq("owner_id", connection.owner_id);
  if (error) throw new Error("X_TOKEN_SAVE_FAILED");
  connection.encrypted_access_token = encrypt(refreshed.access_token);
  connection.encrypted_refresh_token = encrypt(refreshed.refresh_token);
  connection.token_expires_at = expires;
  return refreshed.access_token;
}

function budapestDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest", year: "numeric",
    month: "2-digit", day: "2-digit" }).format(date);
}

function score(post: Post) {
  const m = post.public_metrics ?? {};
  return (m.impression_count ?? 0) + (m.like_count ?? 0) * 100
    + (m.reply_count ?? 0) * 40 + (m.repost_count ?? 0) * 120;
}

export async function scanCommentSuggestions(ownerId?: string) {
  const sb = serviceClient();
  let query = sb.from("x_social_connections")
    .select("id,owner_id,character_id,x_username,encrypted_access_token,encrypted_refresh_token,token_expires_at")
    .eq("enabled", true).limit(25);
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { data, error } = await query;
  if (error) throw new Error(`X_COMMENT_CONNECTIONS_${error.code}`);
  const groups = new Map<string, Connection[]>();
  for (const connection of (data ?? []) as Connection[]) groups.set(connection.owner_id,
    [...(groups.get(connection.owner_id) ?? []), connection]);
  let created = 0;
  const errors: string[] = [];
  for (const [owner, connections] of groups) {
    try {
      // One search per owner per half hour, even with several connected models.
      const windowStart = new Date(Math.floor(Date.now() / 1_800_000) * 1_800_000).toISOString();
      const { error: claimError } = await sb.from("x_comment_scan_runs")
        .insert({ owner_id: owner, window_start: windowStart });
      if (claimError?.code === "23505") continue;
      if (claimError) throw new Error(`X_COMMENT_SCAN_CLAIM_${claimError.code}`);

      const cutoff = new Date(Date.now() - 48 * 60 * 60_000).toISOString();
      const { error: staleError } = await sb.from("x_comment_suggestions")
        .update({ status: "rejected", error: "POST_EXPIRED", acted_at: new Date().toISOString() })
        .eq("owner_id", owner).eq("status", "pending").lt("post_created_at", cutoff);
      if (staleError) throw new Error(`X_COMMENT_EXPIRE_${staleError.code}`);

      const today = budapestDate();
      const { data: existing, error: existingError } = await sb.from("x_comment_suggestions")
        .select("x_post_id,character_id,status,created_at,acted_at").eq("owner_id", owner)
        .order("created_at", { ascending: false }).limit(2000);
      if (existingError) throw new Error(`X_COMMENT_HISTORY_${existingError.code}`);
      const seen = new Set((existing ?? []).map(item => item.x_post_id));
      const rotated = [...connections].sort((a, b) => a.character_id.localeCompare(b.character_id));
      const offset = Math.floor(Date.now() / 1_800_000) % rotated.length;
      const fairOrder = [...rotated.slice(offset), ...rotated.slice(0, offset)];
      const room = fairOrder.map(connection => {
        const rows = (existing ?? []).filter(item => item.character_id === connection.character_id);
        const queued = rows.filter(item => item.status === "pending").length;
        const posted = rows.filter(item => item.status === "posted" && item.acted_at
          && budapestDate(new Date(item.acted_at)) === today).length;
        return { connection, capacity: Math.max(0, Math.min(10 - queued, 35 - posted - queued)) };
      }).filter(item => item.capacity > 0);
      if (!room.length) continue;

      const token = await accessFor(connections[0]);
      const url = new URL("https://api.x.com/2/tweets/search/recent");
      url.search = new URLSearchParams({ query: '("edzés" OR "kávé" OR "hétvége" OR "kirándulás" OR "kutya" OR "zene" OR "étterem" OR "foci") lang:hu min_likes:10 -is:retweet -is:reply',
        max_results: "100", expansions: "author_id", "tweet.fields": "author_id,created_at,lang,possibly_sensitive,public_metrics",
        "user.fields": "username,protected" }).toString();
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`X_COMMENT_SEARCH_${response.status}`);
      const body = await response.json() as { data?: Post[]; includes?: { users?: { id: string; username: string; protected?: boolean }[] } };
      const authors = new Map((body.includes?.users ?? []).map(user => [user.id, user]));
      const posts = (body.data ?? []).filter(post => post.lang === "hu" && !post.possibly_sensitive
        && !seen.has(post.id) && authors.has(post.author_id) && !authors.get(post.author_id)?.protected
        && Date.parse(post.created_at) >= Date.parse(cutoff)
        && (post.public_metrics?.like_count ?? 0) >= 10
        && (post.public_metrics?.impression_count !== undefined
          ? post.public_metrics.impression_count >= 1000
          : (post.public_metrics?.like_count ?? 0) >= 50)
        && looksHungarian(post.text)
        && !/\b(?:orbán|fidesz|tisz[aá]|parlament|kormány|választás|politika|politikus|párt)\b/iu.test(post.text))
        .sort((a, b) => score(b) - score(a));
      console.info("x.comment.scan.filter", { received: body.data?.length ?? 0, eligible: posts.length });
      const assignments = new Map(room.map(item => [item.connection.id, [] as Post[]]));
      const remaining = new Map(room.map(item => [item.connection.id, item.capacity]));
      let next = 0;
      for (const post of posts) {
        let attempts = 0;
        while (attempts < room.length && !remaining.get(room[next].connection.id)) {
          next = (next + 1) % room.length;
          attempts++;
        }
        if (attempts === room.length) break;
        const id = room[next].connection.id;
        assignments.get(id)!.push(post);
        remaining.set(id, remaining.get(id)! - 1);
        next = (next + 1) % room.length;
      }
      for (const item of room) {
        const picked = assignments.get(item.connection.id)!;
        if (!picked.length) continue;
        const generated = await generateContentJson<{ comments?: { postId: string; text: string }[] }>(
          "You write brief, distinct Hungarian comment suggestions for an adult creator's X account. Each reply must address the specific post, add a real thought, and sound like a human. Stay on the actual subject: do not introduce unrelated topics, infer missing details, or claim personal experiences. Prefer one short sentence. No generic compliments, ads, links, hashtags, flirting with minors, sexual content, repeated templates, or invented facts. Return JSON: {\"comments\":[{\"postId\":\"...\",\"text\":\"...\"}]}. A person reviews each suggestion before it is posted.",
          JSON.stringify({ model: item.connection.x_username, posts: picked.map(post => ({ postId: post.id, text: post.text.slice(0, 1200) })) }),
        );
        const suggestions = new Map((generated.comments ?? []).map(comment => [comment.postId, comment.text]));
        for (const post of picked) {
          const draft = suggestions.get(post.id)?.trim();
          if (!draft || draft.length < 8 || draft.length > 220 || /https?:\/\/|fanvue\.|#[\p{L}\p{N}_]+/iu.test(draft)) continue;
          const author = authors.get(post.author_id)!;
          const { error: insertError } = await sb.from("x_comment_suggestions").insert({
            owner_id: owner, character_id: item.connection.character_id, connection_id: item.connection.id,
            x_post_id: post.id, x_author_username: author.username, post_text: post.text,
            like_count: post.public_metrics?.like_count ?? 0, reply_count: post.public_metrics?.reply_count ?? 0,
            repost_count: post.public_metrics?.repost_count ?? 0,
            view_count: post.public_metrics?.impression_count ?? null,
            post_created_at: post.created_at, suggestion: draft,
          });
          if (!insertError) { created++; seen.add(post.id); }
          else if (insertError.code !== "23505") console.error("x.comment.insert", insertError.code);
        }
      }
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : "UNKNOWN";
      console.error("x.comment.scan", owner, code);
      errors.push(code);
    }
  }
  return { created, errors };
}

export { budapestDate };
