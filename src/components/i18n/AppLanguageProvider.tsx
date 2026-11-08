"use client";
import { useCallback } from "react";
import { useAppPreferences } from "@/components/AppPreferences";
import { translateApp } from "@/lib/app-i18n";
export function useAppTranslation() {
  const { locale, setLocale } = useAppPreferences();
  const t = useCallback((source: string, variables?: Record<string, string | number>) => translateApp(locale, source, variables), [locale]);
  return { locale, setLocale, t };
}
