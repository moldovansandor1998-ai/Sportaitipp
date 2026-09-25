// Cron-hitelesítés – fail-closed: hiányzó titok = konfigurációs hiba (500).
export type CronVerdict = "ok" | "no_secret" | "unauthorized";

export function isCronAuthorized(authHeader: string | null, secret: string | undefined): CronVerdict {
  if (!secret) return "no_secret";
  if (!authHeader || authHeader !== `Bearer ${secret}`) return "unauthorized";
  return "ok";
}
