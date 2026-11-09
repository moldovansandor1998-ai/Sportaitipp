/** These fixtures run ONLY inside disposable local Auth; recovery tests use a synthetic identity and a test-scoped owner predicate.
 * They prove legacy lifecycle/recovery, not hosted production access.
 * Refuse remote URLs and paid provider keys before any account or storage write.
 */
export const LOCAL_OWNER_EMAIL = "owner-recovery@example.invalid";
export function assertLocalIntegrationTarget(env: Record<string, string | undefined> = process.env) {
  if (env.INTEGRATION !== "1") throw new Error("LOCAL_INTEGRATION_NOT_ENABLED");
  for (const key of ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]) {
    const url = new URL(env[key] ?? "");
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      || url.port !== "54321" || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
      throw new Error("LOCAL_SUPABASE_REQUIRED");
  }
  if (new URL(env.SUPABASE_URL!).origin !== new URL(env.NEXT_PUBLIC_SUPABASE_URL!).origin)
    throw new Error("LOCAL_SUPABASE_MISMATCH");
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    || env.SUPABASE_SERVICE_ROLE_KEY === env.NEXT_PUBLIC_SUPABASE_ANON_KEY) throw new Error("LOCAL_SUPABASE_KEYS_REQUIRED");
  if (env.NODE_ENV === "production" || env.PROVIDER_ALLOW_MOCK === "false") throw new Error("LOCAL_MOCK_PROVIDER_REQUIRED");
  for (const key of ["FAL_KEY", "REPLICATE_API_TOKEN", "WAVESPEED_API_KEY", "NURETA_API_KEY", "ELEVENLABS_API_KEY"])
    if (env[key]) throw new Error("PAID_PROVIDER_KEY_PRESENT");
}
