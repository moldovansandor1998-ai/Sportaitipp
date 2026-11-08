import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Start AI Creator", template: "%s · Start AI Creator" },
  description: "Saját AI-karakterplatform – karakterek, képek, videók, kreditek.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hu">
      <body>{children}</body>
    </html>
  );
}
