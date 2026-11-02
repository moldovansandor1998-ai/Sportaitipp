"use client";

import { useEffect, useRef, useState } from "react";
import { REDUB_MAX_TEXT, type RedubDelivery } from "@/lib/videoRedub";

interface Media { assetId: string; mediaType: string; url: string | null; characterId?: string | null; }
interface Job { id: string; status: string; }
interface Quote { key: string; credits: number; speechSeconds?: number; sourceSeconds?: number; }
interface Props {
  characterId: string; characterName: string;
  token: () => Promise<string>;
  gallery: Media[]; busy: boolean;
  speechJob?: Job; speechResults: Media[]; videoJob?: Job; videoResults: Media[];
  message?: string;
  onRun: (stage: "speech" | "video", payload: Record<string, unknown>) => void;
  uploadVideo: (onUploaded: (id: string, file: File) => void) => Promise<void>;
}
const active = (job?: Job) => !!job && !["completed", "failed", "refunded", "cancelled", "submission_uncertain"].includes(job.status);
const errors: Record<string, string> = {
  ELEVENLABS_AUTH_FAILED: "Az ElevenLabs nem fogadja el az API-kulcsot. Az adminnak újra be kell állítania a kapcsolatot. Kreditfoglalás nem történt.",
  ELEVENLABS_QUOTA_EXCEEDED: "Elfogyott az ElevenLabs beszédkerete. A szolgáltatói keretet fel kell tölteni. Kreditfoglalás nem történt.",
  ELEVENLABS_PAYMENT_ISSUE: "Az ElevenLabs-fiók számlázását rendezni kell. Kreditfoglalás nem történt.",
  TTS_VOICE_INVALID: "A modell hangja nincs beállítva, megváltozott, vagy a hozzá tartozó beszéd még nem készült el.",
  REDUB_DURATION_LIMIT: "Legfeljebb 3 perces videó és beszéd használható. Nem vágjuk le a szöveg végét.",
  VIDEO_FORMAT_UNSUPPORTED: "A videó vagy a hang nem olvasható. MP4 videót tölts fel, legfeljebb 48 MB méretben.",
  INSUFFICIENT_CREDITS: "Nincs elég kredited ehhez a művelethez.",
  PROVIDER_MODEL_INVALID: "A szükséges hang- vagy videószolgáltató nincs beállítva.",
};

export default function VideoRedub(props: Props) {
  const [text, setText] = useState("");
  const [delivery, setDelivery] = useState<RedubDelivery>("girly");
  const [source, setSource] = useState<{ id: string; url: string } | null>(null);
  const [speechSignature, setSpeechSignature] = useState("");
  const [speechQuote, setSpeechQuote] = useState<Quote | null>(null);
  const [videoQuote, setVideoQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [message, setMessage] = useState("");
  const quoteRevision = useRef(0);
  const localPreview = useRef<string | null>(null);
  useEffect(() => () => { if (localPreview.current) URL.revokeObjectURL(localPreview.current); }, []);
  const signature = JSON.stringify([props.characterId, text.trim(), delivery]);
  const audio = props.speechResults.find(item => item.mediaType === "audio");
  const ready = speechSignature === signature && props.speechJob?.status === "completed" && !!audio?.url;
  const videoKey = JSON.stringify([props.characterId, source?.id, props.speechJob?.id]);
  const locked = props.busy || quoting || active(props.speechJob) || active(props.videoJob);
  const invalidate = () => { quoteRevision.current++; setMessage(""); setVideoQuote(null); setSpeechQuote(null); };

  async function quote(stage: "speech" | "video") {
    if (locked) return;
    const revision = ++quoteRevision.current;
    const key = stage === "speech" ? signature : videoKey;
    setQuoting(true); setMessage("");
    try {
      const response = await fetch("/api/jobs/estimate", { method: "POST",
        headers: { authorization: `Bearer ${await props.token()}`, "content-type": "application/json" },
        body: JSON.stringify({ type: stage === "speech" ? "tts" : "lip_sync", characterId: props.characterId,
          payload: stage === "speech" ? { videoRedubSpeech: true, text: text.trim(), delivery }
            : { videoRedub: true, videoAssetId: source?.id, speechJobId: props.speechJob?.id } }),
      });
      const data = await response.json() as { credits?: number; error?: string; sourceSeconds?: number; speechSeconds?: number };
      if (!response.ok || typeof data.credits !== "number") throw new Error(errors[data.error ?? ""] ?? data.error ?? "Az ár nem kérhető le.");
      if (revision !== quoteRevision.current) return;
      const result = { key, credits: data.credits, sourceSeconds: data.sourceSeconds, speechSeconds: data.speechSeconds };
      if (stage === "speech") setSpeechQuote(result); else setVideoQuote(result);
    } catch (error) { if (revision === quoteRevision.current) setMessage(error instanceof Error ? error.message : "Hiba történt."); }
    finally { setQuoting(false); }
  }

  return <section className="card" style={{ marginBottom: 16 }} aria-labelledby="redub-title">
    <h2 id="redub-title" style={{ marginTop: 0 }}>Új szöveg a kész videóra · hang és szájszinkron</h2>
    <p className="muted">Tölts fel egy kész modellvideót, vagy válassz a galériából. Az új szöveg a kiválasztott modell saját hangján szólal meg, és a szájmozgást is hozzá igazítjuk. A meglévő felvételt használjuk, új jelenetkép nélkül.</p>
    <p><strong>Modell: {props.characterName || "Fent válassz modellt"}</strong></p>
    <label htmlFor="redub-video">Alapvideó a galériából</label>
    <select id="redub-video" value={source?.id ?? ""} disabled={locked} onChange={event => {
      const item = props.gallery.find(item => item.assetId === event.target.value);
      invalidate(); setSource(item?.url ? { id: item.assetId, url: item.url } : null);
    }}>
      <option value="">Válassz videót vagy tölts fel sajátot</option>
      {source && !props.gallery.some(item => item.assetId === source.id) && <option value={source.id}>Saját feltöltött videó</option>}
      {props.gallery.filter(item => item.mediaType === "video" && item.url && item.characterId === props.characterId)
        .map((item, index) => <option key={item.assetId} value={item.assetId}>Modellvideó {index + 1}</option>)}
    </select>
    <button type="button" className="ghost" disabled={locked || !props.characterId} style={{ marginTop: 8 }} onClick={async () => {
      setMessage("");
      await props.uploadVideo((id, file) => {
        invalidate();
        if (localPreview.current) URL.revokeObjectURL(localPreview.current);
        localPreview.current = URL.createObjectURL(file);
        setSource({ id, url: localPreview.current });
        setMessage("Saját alapvideó feltöltve.");
      });
    }}>Saját modellvideó feltöltése (MP4, max. 48 MB)</button>
    {source && <video key={source.id} src={source.url} controls playsInline preload="metadata"
      style={{ display: "block", maxWidth: "100%", maxHeight: 380, marginTop: 12 }} />}
    <p className="muted">Legfeljebb 3 perces, egy jól látható beszélővel készült videót használj. Az új videó a teljes beszéd hosszához igazodik: ha rövid az alap, a mozgása ismétlődik; ha hosszabb, a végét levágjuk. A beszédet nem csonkítjuk, és nem gyorsítjuk fel erőltetetten.</p>
    <label htmlFor="redub-text">Mit mondjon a modell?</label>
    <textarea id="redub-text" maxLength={REDUB_MAX_TEXT} value={text} disabled={locked}
      placeholder="Másold be a teljes szöveget, például: Story timeee!…"
      onChange={event => { invalidate(); setText(event.target.value); }}
      style={{ width: "100%", minHeight: 170, display: "block", marginTop: 6 }} />
    <p className="muted">{text.length}/{REDUB_MAX_TEXT} karakter · A tényleges hossz a kész hang meghallgatásakor látható.</p>
    <label htmlFor="redub-delivery">Előadásmód</label>
    <select id="redub-delivery" value={delivery} disabled={locked} onChange={event => { invalidate(); setDelivery(event.target.value as RedubDelivery); }}>
      <option value="girly">Csajos, vidám TikTok-előadás</option>
      <option value="natural">Természetes, beszélgetős</option>
      <option value="energetic">Lendületes, lelkes</option>
    </select>
    <h3>1. Saját modellhang elkészítése és meghallgatása</h3>
    <button type="button" className="ghost" disabled={locked || !props.characterId || !text.trim()} onClick={() => void quote("speech")}>Hangkészítés árának lekérése</button>
    {speechQuote?.key === signature && <button type="button" disabled={locked} style={{ marginLeft: 8 }} onClick={() => {
      setSpeechSignature(signature); setVideoQuote(null);
      props.onRun("speech", { videoRedubSpeech: true, text: text.trim(), delivery });
    }}>Hang készítése · {speechQuote.credits} kredit</button>}
    {props.speechJob && <p className="muted" role="status">Hang: {props.speechJob.status}</p>}
    {ready && <audio key={props.speechJob?.id} src={audio!.url!} controls preload="metadata" style={{ display: "block", width: "100%", marginTop: 10 }} />}
    {!ready && audio && <p className="muted">Az új szöveghez vagy előadásmódhoz készíts új hangot.</p>}
    <h3>2. A jóváhagyott hanghoz igazított szájmozgás</h3>
    <button type="button" className="ghost" disabled={locked || !ready || !source} onClick={() => void quote("video")}>Szájszinkron árának és hosszának lekérése</button>
    {ready && videoQuote?.key === videoKey && <>
      <p>A kész videó kb. <strong>{videoQuote.speechSeconds} másodperc</strong>. Alapvideó: {videoQuote.sourceSeconds} másodperc.
        {Number(videoQuote.speechSeconds) > Number(videoQuote.sourceSeconds) ? " A felvétel ismétlődik, hogy a teljes szöveg beleférjen." : " A felvétel a beszéd végén ér véget."}</p>
      <button type="button" disabled={locked} onClick={() => props.onRun("video", { videoRedub: true,
        videoAssetId: source!.id, speechJobId: props.speechJob!.id })}>Videó készítése szájszinkronnal · {videoQuote.credits} kredit</button>
    </>}
    {props.videoJob && <p className="muted" role="status">Szájszinkron: {props.videoJob.status}</p>}
    {(message || props.message) && <p className="muted" role="status">{message || props.message}</p>}
    {props.videoResults.filter(item => item.mediaType === "video" && item.url).map(item => <div key={item.assetId} style={{ marginTop: 12 }}>
      <video src={item.url!} controls playsInline style={{ maxWidth: "100%", maxHeight: 600 }} />
      <p><a href={item.url!} download>Videó letöltése</a> · <a href="/gallery">Megnyitás a galériában</a></p>
    </div>)}
    <p className="muted">A kész videóban ellenőrizd az arcot, a kiejtést és a szájmozgást. A hangkészítés és a szájszinkron külön, a fenti gombokon jelzett kredittel jár.</p>
  </section>;
}
