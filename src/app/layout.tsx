import type { Metadata } from "next";
import { headers } from "next/headers";
import DocumentLanguage from "@/components/marketing/DocumentLanguage";
import { PUBLIC_LOCALE_HEADER } from "@/lib/public-locale";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Start AI Creator", template: "%s · Start AI Creator" },
  description: "Saját AI-karakterplatform – karakterek, képek, videók, kreditek.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = (await headers()).get(PUBLIC_LOCALE_HEADER) === "en" ? "en" : "hu";
  return (
    <html lang={locale}>
      <body><DocumentLanguage />{children}</body>
    </html>
  );
}
