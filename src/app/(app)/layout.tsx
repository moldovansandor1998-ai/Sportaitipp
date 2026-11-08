import { cookies } from "next/headers";
import AppShell from "@/components/AppShell";
import { isAppLocale } from "@/lib/app-i18n";
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const value = (await cookies()).get("start-ai-locale")?.value;
  return <AppShell initialLocale={isAppLocale(value) ? value : undefined}>{children}</AppShell>;
}
