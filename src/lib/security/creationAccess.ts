import "server-only";
import { serviceClient } from "@/lib/supabase/server";

export type CreationAccessCode = "ACCOUNT_UNAVAILABLE" | "PAYMENT_REVIEW" | "CREATION_ACCESS_UNAVAILABLE";
export class CreationAccessDenied extends Error {
  readonly status: number;
  constructor(readonly code: CreationAccessCode) {
    super(code);
    this.status = code === "CREATION_ACCESS_UNAVAILABLE" ? 503 : 403;
  }
}
export function isCreationAccessCode(code: unknown): code is CreationAccessCode {
  return code === "ACCOUNT_UNAVAILABLE" || code === "PAYMENT_REVIEW" || code === "CREATION_ACCESS_UNAVAILABLE";
}

/** Server-authenticated owner only. Pricing exemptions never exempt access checks.
 * Read-only: no balance changes, review dismissal, or interference with submitted recovery.
 * This is a fresh service-side check, not a transaction lock against concurrent webhooks.
 */
export async function assertCreationAllowed(userId: string): Promise<void> {
  try {
    const sb = serviceClient();
    const { data: profile, error } = await sb.from("profiles")
      .select("banned_until").eq("id", userId).single();
    if (error) throw new CreationAccessDenied("CREATION_ACCESS_UNAVAILABLE");
    if (!profile) throw new CreationAccessDenied("ACCOUNT_UNAVAILABLE");
    if (profile.banned_until !== null) {
      const until = typeof profile.banned_until === "string" ? Date.parse(profile.banned_until) : NaN;
      if (!Number.isFinite(until)) throw new CreationAccessDenied("CREATION_ACCESS_UNAVAILABLE");
      if (until > Date.now()) throw new CreationAccessDenied("ACCOUNT_UNAVAILABLE");
    }

    // Reviews intentionally have no membership FK (a reversal can arrive before
    // its receipt). Resolve only this app owner's persisted membership bindings.
    // Keyset pages avoid silently ignoring reviews beyond PostgREST's row cap.
    let after: string | undefined;
    for (;;) {
      let query = sb.from("whop_card_memberships")
        .select("membership_id,whop_card_bindings!inner(user_id)")
        .eq("whop_card_bindings.user_id", userId).order("membership_id").limit(100);
      if (after !== undefined) query = query.gt("membership_id", after);
      const { data: memberships, error: membershipError } = await query;
      if (membershipError || !Array.isArray(memberships)) throw new CreationAccessDenied("CREATION_ACCESS_UNAVAILABLE");
      if (memberships.length === 0) return;
      const ids = memberships.map(row => {
        const binding = row.whop_card_bindings as unknown as { user_id?: string } | null;
        if (typeof row.membership_id !== "string" || !row.membership_id
          || binding?.user_id !== userId || (after !== undefined && row.membership_id <= after))
          throw new CreationAccessDenied("CREATION_ACCESS_UNAVAILABLE");
        return row.membership_id;
      });
      const { data: reviews, error: reviewError } = await sb.from("whop_card_reviews")
        .select("payment_id").in("membership_id", ids).limit(1);
      if (reviewError || !Array.isArray(reviews)) throw new CreationAccessDenied("CREATION_ACCESS_UNAVAILABLE");
      if (reviews.length > 0) throw new CreationAccessDenied("PAYMENT_REVIEW");
      after = ids[ids.length - 1];
    }
  } catch (error) {
    if (error instanceof CreationAccessDenied) throw error;
    // Missing tables, network failures and malformed responses cannot become permission.
    throw new CreationAccessDenied("CREATION_ACCESS_UNAVAILABLE");
  }
}
