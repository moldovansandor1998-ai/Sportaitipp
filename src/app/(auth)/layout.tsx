import { cookies } from "next/headers";
import AuthLanguageFrame from "@/components/i18n/AuthLanguageFrame";
import { isAppLocale } from "@/lib/app-i18n";
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const value = (await cookies()).get("start-ai-locale")?.value;
  return <AuthLanguageFrame initialLocale={isAppLocale(value) ? value : "en"}>{children}</AuthLanguageFrame>;
}
