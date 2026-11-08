/** Explicit public URLs; language selection never depends on geolocation. */
export const PUBLIC_LOCALE_HEADER = "x-start-ai-public-locale";
export const PUBLIC_LOCALES = ["en", "hu", "ro", "it", "de", "fr", "sk", "pl"] as const;
export type PublicLocale = typeof PUBLIC_LOCALES[number];
export const PUBLIC_LANGUAGE_NAMES: Record<PublicLocale, string> = {
  en: "English", hu: "Magyar", ro: "Română", it: "Italiano", de: "Deutsch", fr: "Français", sk: "Slovenčina", pl: "Polski",
};
export const OPEN_GRAPH_LOCALES: Record<PublicLocale, string> = {
  en: "en_US", hu: "hu_HU", ro: "ro_RO", it: "it_IT", de: "de_DE", fr: "fr_FR", sk: "sk_SK", pl: "pl_PL",
};
export function isPublicLocale(value: unknown): value is PublicLocale {
  return typeof value === "string" && (PUBLIC_LOCALES as readonly string[]).includes(value);
}
export function publicLocalePath(locale: PublicLocale): string { return locale === "en" ? "/" : `/${locale}`; }
export function publicLocaleFromPath(pathname: string): PublicLocale | null {
  const path = pathname.replace(/\/$/, "") || "/";
  if (path === "/" || path === "/en") return "en";
  const locale = path.slice(1);
  return isPublicLocale(locale) ? locale : null;
}
export function documentLocale(pathname: string): PublicLocale {
  return publicLocaleFromPath(pathname) ?? "hu";
}

/** Only call for an explicit public page/choice, never from inferred location. */
export function rememberPublicLocale(locale: PublicLocale): void {
  if (typeof document === "undefined") return;
  try { document.cookie = `start-ai-locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`; } catch { /* Storage can be blocked. Links still work. */ }
  try { localStorage.setItem("start-ai-locale", locale); } catch { /* Private browsing can disable storage. */ }
}
