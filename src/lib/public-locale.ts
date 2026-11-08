/** Only the international public landing pages use English by default. */
export const PUBLIC_LOCALE_HEADER = "x-start-ai-public-locale";

export function documentLocale(pathname: string): "en" | "hu" {
  return pathname === "/" || pathname === "/en" ? "en" : "hu";
}
