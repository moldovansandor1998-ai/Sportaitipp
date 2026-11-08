"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { publicLocaleFromPath, rememberPublicLocale } from "@/lib/public-locale";

/** Root layouts persist across client navigation, so keep their lang accurate. */
export default function DocumentLanguage() {
  const pathname = usePathname();
  useEffect(() => {
    const locale = publicLocaleFromPath(pathname);
    // The app preference provider owns language on authenticated/internal routes.
    if (!locale) return;
    const apply = () => {
      document.documentElement.lang = locale;
      rememberPublicLocale(locale);
    };
    apply();
    // Back/forward cache restores may not remount React components.
    window.addEventListener("pageshow", apply);
    return () => window.removeEventListener("pageshow", apply);
  }, [pathname]);
  return null;
}
