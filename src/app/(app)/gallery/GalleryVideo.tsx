"use client";

import { useState } from "react";

export default function GalleryVideo({ url, onRefresh }: { url: string | null; onRefresh: () => void }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = !url || failedUrl === url;
  return <div>
    {url && <video src={`${url}#t=0.1`} controls playsInline preload="metadata"
      style={{ width: "100%", borderRadius: 8 }} onError={() => setFailedUrl(url)} />}
    {failed && <p role="status">A videó nem tölthető be. Frissítsd a hozzáférési linket.
      <button className="ghost" onClick={onRefresh}>Videó frissítése</button>
    </p>}
    {url && <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
      <a href={url} target="_blank" rel="noopener noreferrer">Videó megnyitása</a>
      <a href={url} download>Videó letöltése</a>
    </div>}
  </div>;
}
