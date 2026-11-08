"use client";
import type { AppLocale } from "@/lib/app-i18n";
import { AppPreferences, LanguagePicker } from "@/components/AppPreferences";
export default function AuthLanguageFrame({ children, initialLocale }: { children: React.ReactNode; initialLocale?: AppLocale }) {
  return <AppPreferences isAdmin={false} initialLocale={initialLocale}><div style={{ position: "absolute", top: 16, right: 16 }}><LanguagePicker /></div>{children}</AppPreferences>;
}
