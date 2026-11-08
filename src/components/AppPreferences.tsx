"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { APP_LOCALES, APP_LANGUAGE_NAMES, isAppLocale, type AppLocale } from "@/lib/app-i18n";
const Context = createContext({ locale: "en" as AppLocale, setLocale: (() => {}) as (value: AppLocale) => void, isAdmin: false });
export function AppPreferences({ children, isAdmin, initialLocale }: { children: React.ReactNode; isAdmin: boolean; initialLocale?: AppLocale }) {
  const [locale, setLocale] = useState<AppLocale>(initialLocale ?? (isAdmin ? "hu" : "en"));
  useEffect(() => {
    const restore = () => { try {
      const cookie = document.cookie.split(";").map(value => value.trim()).find(value => value.startsWith("start-ai-locale="))?.split("=")[1];
      const stored = cookie ?? localStorage.getItem("start-ai-locale");
      if (isAppLocale(stored)) setLocale(stored);
      else setLocale(initialLocale ?? (isAdmin ? "hu" : "en"));
    } catch { setLocale(initialLocale ?? (isAdmin ? "hu" : "en")); } };
    restore();
    window.addEventListener("pageshow", restore);
    window.addEventListener("storage", restore);
    return () => { window.removeEventListener("pageshow", restore); window.removeEventListener("storage", restore); };
  }, [isAdmin, initialLocale]);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  function changeLocale(value: AppLocale) {
    if (!isAppLocale(value)) return;
    setLocale(value);
    try { localStorage.setItem("start-ai-locale", value); } catch { /* Storage may be disabled. */ }
    try {
      document.cookie = `start-ai-locale=${value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    } catch { /* Keep the current-session choice. */ }
  }
  return <Context.Provider value={{ locale, setLocale: changeLocale, isAdmin }}>{children}</Context.Provider>;
}
export const useAppPreferences = () => useContext(Context);
export function LanguagePicker() {
  const { locale, setLocale } = useAppPreferences();
  return <select className="app-language" aria-label={APP_LANGUAGE_NAMES[locale]} value={locale} onChange={e => { if (isAppLocale(e.target.value)) setLocale(e.target.value); }}>
    {APP_LOCALES.map(value => <option key={value} value={value}>{APP_LANGUAGE_NAMES[value]}</option>)}
  </select>;
}
