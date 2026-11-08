import { workspaceMessages } from "./app-i18n/sections/workspace";
import { toolsMessages } from "./app-i18n/sections/tools";
import { statusMessages } from "./app-i18n/sections/status";
import { coreMessages } from "./app-i18n/sections/core";
export const APP_LOCALES = ["en", "hu", "ro", "it", "de", "fr", "sk", "pl"] as const;
export type AppLocale = (typeof APP_LOCALES)[number];
export type AppMessages = Partial<Record<AppLocale, Record<string, string>>>;
export const APP_LANGUAGE_NAMES: Record<AppLocale, string> = { en: "English", hu: "Magyar", ro: "Română", it: "Italiano", de: "Deutsch", fr: "Français", sk: "Slovenčina", pl: "Polski" };
export function isAppLocale(value: unknown): value is AppLocale { return typeof value === "string" && (APP_LOCALES as readonly string[]).includes(value); }
export const appMessages: AppMessages = Object.fromEntries(APP_LOCALES.map(locale => [locale, { ...workspaceMessages[locale], ...toolsMessages[locale], ...statusMessages[locale], ...coreMessages[locale] }]));
export function translateApp(locale: AppLocale, source: string, variables: Record<string, string | number> = {}): string {
  const template = appMessages[locale]?.[source] ?? (locale === "hu" ? source : appMessages.en?.[source] ?? source);
  return template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (match, key: string) => Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key]) : match);
}
