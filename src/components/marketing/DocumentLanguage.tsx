"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { documentLocale } from "@/lib/public-locale";

/** Root layouts persist across client navigation, so keep their lang accurate. */
export default function DocumentLanguage() {
  const pathname = usePathname();
  useEffect(() => {
    document.documentElement.lang = documentLocale(pathname);
  }, [pathname]);
  return null;
}
