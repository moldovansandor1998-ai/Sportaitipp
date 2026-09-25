import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Castora", template: "%s · Castora" },
  description: "Saját AI-karakterplatform – karakterek, képek, videók, kreditek.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hu">
      <body>{children}</body>
    </html>
  );
}
