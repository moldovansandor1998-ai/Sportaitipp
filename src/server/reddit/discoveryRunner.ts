import "server-only";
import { serviceClient } from "@/lib/supabase/server";
import { decrypt, encrypt, refreshToken, redditApproved, redditConfigured } from "./client";
import { discoverCommunities } from "./discovery";
export class DiscoveryError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}
/** Shared cadence, lease, encrypted refresh, and persistence for manual and cron discovery. */
export async function discoverForAccount(ownerId: string, characterId: string, now = new Date()) {
  if (!redditApproved()) throw new DiscoveryError("REDDIT_API_NOT_APPROVED", 503);
  if (!redditConfigured()) throw new DiscoveryError("REDDIT_APP_NOT_CONFIGURED", 503);
  const sb = serviceClient();
  const { data: account, error } = await sb.from("reddit_social_connections").select("id,last_discovery_at,discovery_lease_until")
    .eq("owner_id", ownerId).eq("character_id", characterId).maybeSingle();
  if (error || !account) throw new DiscoveryError("REDDIT_ACCOUNT_NOT_FOUND", 404);
  const cutoff = new Date(now.getTime() - 86_400_000).toISOString();
  if (account.last_discovery_at && account.last_discovery_at > cutoff) throw new DiscoveryError("REDDIT_DISCOVERY_COOLDOWN", 429);
  const leaseUntil = new Date(now.getTime() + 600_000).toISOString();
  const { data: leased, error: leaseError } = await sb.from("reddit_social_connections").update({ discovery_lease_until: leaseUntil })
    .eq("id", account.id).eq("owner_id", ownerId)
    .or(`last_discovery_at.is.null,last_discovery_at.lt.${cutoff}`)
    .or(`discovery_lease_until.is.null,discovery_lease_until.lt.${now.toISOString()}`)
    .select("encrypted_access_token,encrypted_refresh_token,token_expires_at").maybeSingle();
  if (leaseError) throw new DiscoveryError("REDDIT_DISCOVERY_LEASE_FAILED", 500);
  if (!leased) throw new DiscoveryError("REDDIT_DISCOVERY_BUSY", 409);
  try {
    let access: string;
    if (!leased.token_expires_at || new Date(leased.token_expires_at).getTime() < Date.now() + 60_000) {
      const token = await refreshToken(decrypt(leased.encrypted_refresh_token));
      access = token.access_token;
      const saved = await sb.from("reddit_social_connections").update({ encrypted_access_token: encrypt(access),
        ...(token.refresh_token ? { encrypted_refresh_token: encrypt(token.refresh_token) } : {}),
        token_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
      }).eq("id", account.id).eq("owner_id", ownerId).eq("discovery_lease_until", leaseUntil).select("id").maybeSingle();
      if (saved.error || !saved.data) throw new Error("TOKEN_SAVE_FAILED");
    } else access = decrypt(leased.encrypted_access_token);
    const candidates = await discoverCommunities(access);
    if (candidates.length) {
      const saved = await sb.from("reddit_community_candidates").upsert(candidates.map(candidate => ({ ...candidate, owner_id: ownerId, character_id: characterId })), { onConflict: "owner_id,character_id,subreddit" });
      if (saved.error) throw new Error("CANDIDATE_SAVE_FAILED");
    }
    const lastDiscoveryAt = new Date().toISOString();
    const saved = await sb.from("reddit_social_connections").update({ last_discovery_at: lastDiscoveryAt, discovery_lease_until: null })
      .eq("id", account.id).eq("owner_id", ownerId).eq("discovery_lease_until", leaseUntil).select("id").maybeSingle();
    if (saved.error || !saved.data) throw new Error("DISCOVERY_SAVE_FAILED");
    return { candidates, lastDiscoveryAt };
  } catch {
    // Failed attempts also cool down, avoiding a retry storm against Reddit.
    await sb.from("reddit_social_connections").update({ last_discovery_at: new Date().toISOString(), discovery_lease_until: null })
      .eq("id", account.id).eq("owner_id", ownerId).eq("discovery_lease_until", leaseUntil);
    throw new DiscoveryError("REDDIT_DISCOVERY_FAILED", 502);
  }
}
/** At most one connected account per tick; discovering never enables posting. */
export async function discoverDueCommunities(now = new Date()): Promise<{ checked: number; candidates: number }> {
  if (!redditApproved() || !redditConfigured()) return { checked: 0, candidates: 0 };
  const cutoff = new Date(now.getTime() - 86_400_000).toISOString();
  const { data, error } = await serviceClient().from("reddit_social_connections").select("owner_id,character_id")
    .or(`last_discovery_at.is.null,last_discovery_at.lt.${cutoff}`)
    .or(`discovery_lease_until.is.null,discovery_lease_until.lt.${now.toISOString()}`)
    .order("last_discovery_at", { ascending: true, nullsFirst: true }).limit(1).maybeSingle();
  if (error) throw new DiscoveryError("REDDIT_DISCOVERY_STATUS_FAILED", 500);
  if (!data) return { checked: 0, candidates: 0 };
  try {
    const result = await discoverForAccount(data.owner_id, data.character_id, now);
    return { checked: 1, candidates: result.candidates.length };
  } catch (error) {
    if (error instanceof DiscoveryError && [409, 429, 404].includes(error.status)) return { checked: 0, candidates: 0 };
    throw new DiscoveryError("REDDIT_DISCOVERY_FAILED", 502);
  }
}
