import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import { APP_LOCALES, translateApp } from "@/lib/app-i18n";
const state = vi.hoisted(() => ({ locale: "en", owner: false }));
vi.mock("@/components/AppPreferences", () => ({
  useAppPreferences: () => ({ locale: state.locale, isAdmin: state.owner, setLocale: () => {} }),
  AppPreferences: ({ children }: { children: React.ReactNode }) => children,
  LanguagePicker: () => null,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ push: () => {} }) }));
import LoginPage from "@/app/(auth)/login/page";
import RegisterPage from "@/app/(auth)/register/page";
import ResetPage from "@/app/auth/reset/page";
import NewCharacterPage from "@/app/(app)/characters/new/page";
import DashboardPage from "@/app/(app)/dashboard/page";
import AppLayout from "@/components/AppShell";
Object.assign(globalThis, { React });
const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
describe("localized customer and owner surfaces", () => {
  it.each(APP_LOCALES)("renders auth, creation and customer dashboard in %s", locale => {
    state.locale = locale; state.owner = false;
    const pages = [[LoginPage, "Bejelentkezés"], [RegisterPage, "Regisztráció"], [ResetPage, "Elfelejtett jelszó"], [NewCharacterPage, "Új karakter"], [DashboardPage, "Mit alkotsz ma?"]] as const;
    for (const [Page, key] of pages) {
      const html = renderToStaticMarkup(React.createElement(Page));
      expect(html).toContain(escapeHtml(translateApp(locale, key)));
      expect(html).not.toMatch(/\{(?:count|name)\}/);
    }
  });
  it.each(APP_LOCALES)("preserves owner-only navigation in %s", locale => {
    state.locale = locale;
    state.owner = false;
    const customer = renderToStaticMarkup(React.createElement(AppLayout, null, "content"));
    expect(customer).not.toContain('href="/model-studio"'); expect(customer).not.toContain('href="/admin"');
    state.owner = true;
    const owner = renderToStaticMarkup(React.createElement(AppLayout, null, "content"));
    expect(owner).toContain('href="/model-studio"'); expect(owner).toContain('href="/admin"');
    expect(owner).toContain(escapeHtml(translateApp(locale, "Menü megnyitása")));

  });
});
