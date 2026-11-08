"use client";

import { useAppTranslation } from "@/components/i18n/AppLanguageProvider";
import { useState } from "react";

export default function GalleryVideo({ url, onRefresh }: { url: string | null; onRefresh: () => void }) {
  const { t } = useAppTranslation();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = !url || failedUrl === url;
  return <div>
    {url && <video src={`${url}#t=0.1`} controls playsInline preload="metadata"
      style={{ width: "100%", borderRadius: 8 }} onError={() => setFailedUrl(url)} />}
    {failed && <p role="status">{t("A videó nem tölthető be. Frissítsd a hozzáférési linket.")}
      <button className="ghost" onClick={onRefresh}>{t("Videó frissítése")}</button>
    </p>}
    {url && <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
      <a href={url} target="_blank" rel="noopener noreferrer">{t("Videó megnyitása")}</a>
      <a href={url} download>{t("Videó letöltése")}</a>
    </div>}
  </div>;
}
