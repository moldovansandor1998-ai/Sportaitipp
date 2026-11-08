"use client";

import { PUBLIC_LOCALES, PUBLIC_LANGUAGE_NAMES, publicLocalePath, rememberPublicLocale, type PublicLocale } from "@/lib/public-locale";
import { Icon } from "./Artwork";
import styles from "./LandingPage.module.css";

/** Real links work without JavaScript; an explicit choice also carries into the app. */
export default function LanguagePicker({ locale, label }: { locale: PublicLocale; label: string }) {
  return <details className={styles.languagePicker}>
    <summary aria-label={label}><Icon name="globe" /><span lang={locale}>{PUBLIC_LANGUAGE_NAMES[locale]}</span><span aria-hidden="true">▾</span></summary>
    <nav aria-label={label}>
      {PUBLIC_LOCALES.map(other => <a key={other} href={publicLocalePath(other)} hrefLang={other} lang={other} aria-current={other === locale ? "page" : undefined} onClick={() => rememberPublicLocale(other)}>{PUBLIC_LANGUAGE_NAMES[other]}</a>)}
    </nav>
  </details>;
}
