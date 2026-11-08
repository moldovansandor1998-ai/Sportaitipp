"use client";
import { useAppTranslation } from "@/components/i18n/AppLanguageProvider";

import { useEffect, useId, useRef, useState } from "react";
import { REDUB_MAX_TEXT, type RedubDelivery } from "@/lib/videoRedub";
import { TALKING_COMMENT_SCRIPT, type TalkingMotion } from "@/lib/imageTalking";

interface Media { assetId: string; mediaType: string; url: string | null; characterId?: string | null; }
interface Job { id: string; status: string; }
interface Quote { key: string; credits: number; speechSeconds?: number; sourceSeconds?: number; }
interface Props {
  mode?: "video" | "image";
  characterId: string; characterName: string;
  token: () => Promise<string>;
  gallery: Media[]; busy: boolean;
  speechJob?: Job; speechResults: Media[]; videoJob?: Job; videoResults: Media[];
  message?: string;
  onRun: (stage: "speech" | "video", payload: Record<string, unknown>) => void;
  restoreSpeech: (jobId: string, characterId: string) => Promise<void>;
  uploadVideo: (onUploaded: (id: string, file: File) => void) => Promise<void>;
  uploadImage?: (onUploaded: (id: string, file: File) => void) => Promise<void>;
}
const active = (job?: Job) => !!job && !["completed", "failed", "refunded", "cancelled", "submission_uncertain"].includes(job.status);


export default function VideoRedub(props: Props) {
  const { t } = useAppTranslation();
const errors: Record<string, string> = {
  ELEVENLABS_AUTH_FAILED: t("Az ElevenLabs nem fogadja el az API-kulcsot. Az adminnak újra be kell állítania a kapcsolatot. Kreditfoglalás nem történt."),
  ELEVENLABS_QUOTA_EXCEEDED: t("Elfogyott az ElevenLabs beszédkerete. A szolgáltatói keretet fel kell tölteni. Kreditfoglalás nem történt."),
  ELEVENLABS_PAYMENT_ISSUE: t("Az ElevenLabs-fiók számlázását rendezni kell. Kreditfoglalás nem történt."),
  TTS_VOICE_INVALID: t("A modell hangja nincs beállítva, megváltozott, vagy a hozzá tartozó beszéd még nem készült el."),
  REDUB_DURATION_LIMIT: t("Legfeljebb 3 perces videó és beszéd használható. Nem vágjuk le a szöveg végét."),
  VIDEO_FORMAT_UNSUPPORTED: t("A videó vagy a hang nem olvasható. MP4 videót tölts fel, legfeljebb 48 MB méretben."),
  INSUFFICIENT_CREDITS: t("Nincs elég kredited ehhez a művelethez."),
  PROVIDER_MODEL_INVALID: t("A szükséges hang- vagy videószolgáltató nincs beállítva."),
  IMAGE_INPUT_REQUIRED: t("Válassz vagy tölts fel egy saját JPG, PNG vagy WebP modellképet, legfeljebb 10 MB méretben."),
};
  const imageMode = props.mode === "image";
  const inputId = useId();
  const [text, setText] = useState("");
  const [delivery, setDelivery] = useState<RedubDelivery>(imageMode ? "curious" : "girly");
  const [motion, setMotion] = useState<TalkingMotion>("natural");
  const [resolution, setResolution] = useState<"480p" | "720p">("720p");
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
  const videoKey = JSON.stringify([props.characterId, source?.id, props.speechJob?.id, props.mode, motion, resolution]);
  const videoPayload = imageMode ? { imageTalking: true, imageAssetId: source?.id, speechJobId: props.speechJob?.id, motion, resolution }
    : { videoRedub: true, videoAssetId: source?.id, speechJobId: props.speechJob?.id };
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
        body: JSON.stringify({ type: stage === "speech" ? "tts" : imageMode ? "talking_video" : "lip_sync", characterId: props.characterId,
          payload: stage === "speech" ? { videoRedubSpeech: true, text: text.trim(), delivery }
            : videoPayload }),
      });
      const data = await response.json() as { credits?: number; error?: string; sourceSeconds?: number; speechSeconds?: number };
      if (!response.ok || typeof data.credits !== "number") throw new Error(errors[data.error ?? ""] ?? data.error ?? t("Az ár nem kérhető le."));
      if (revision !== quoteRevision.current) return;
      const result = { key, credits: data.credits, sourceSeconds: data.sourceSeconds, speechSeconds: data.speechSeconds };
      if (stage === "speech") setSpeechQuote(result); else setVideoQuote(result);
    } catch (error) { if (revision === quoteRevision.current) setMessage(error instanceof Error ? error.message : t("Hiba történt.")); }
    finally { setQuoting(false); }
  }

  async function restoreSpeech() {
    if (locked || !props.characterId) return;
    setQuoting(true); setMessage("");
    const revision = ++quoteRevision.current;
    try {
      const response = await fetch(`/api/video-redub/speech?characterId=${encodeURIComponent(props.characterId)}`, {
        headers: { authorization: `Bearer ${await props.token()}` }, cache: "no-store",
      });
      const data = await response.json() as { jobId?: string; text?: string; delivery?: RedubDelivery; error?: string };
      if (!response.ok || !data.jobId || !data.text) throw new Error(data.error === "NO_COMPLETED_SPEECH"
        ? t("Ehhez a modellhez még nincs visszatölthető, elkészült beszéd.") : errors[data.error ?? ""] ?? t("A korábbi hang nem tölthető vissza."));
      if (quoteRevision.current !== revision) return;
      await props.restoreSpeech(data.jobId, props.characterId);
      const savedDelivery = data.delivery ?? "natural";
      setText(data.text); setDelivery(savedDelivery);
      setSpeechSignature(JSON.stringify([props.characterId, data.text.trim(), savedDelivery]));
      setSpeechQuote(null); setVideoQuote(null);
      setMessage(t("Az elkészült hang visszatöltve. Új hanggenerálás és újabb kreditlevonás nélkül használhatod a szájszinkronhoz."));
    } catch (error) { setMessage(error instanceof Error ? error.message : t("Visszatöltési hiba.")); }
    finally { setQuoting(false); }
  }

  return <section className="card" style={{ marginBottom: 16 }} aria-labelledby={`${inputId}-title`}>
    <h2 id={`${inputId}-title`} style={{ marginTop: 0 }}>{imageMode ? t("Képből beszélő videó · saját szöveg és modellhang") : t("Új szöveg a kész videóra · hang és szájszinkron")}</h2>
    <p className="muted">{imageMode
      ? t("Válassz egy kiinduló modellképet, írd meg, mit mondjon, és válaszd ki a hangulatát. A saját hangjához igazított szájmozgás, mimika és gesztusok készülnek. Először meghallgathatod a beszédet.")
      : t("Tölts fel egy kész modellvideót, vagy válassz a galériából. Az új szöveg a kiválasztott modell saját hangján szólal meg, és a szájmozgást is hozzá igazítjuk. A meglévő felvételt használjuk, új jelenetkép nélkül.")}</p>
    <p><strong>{t("Modell:")}{" "}{props.characterName || t("Fent válassz modellt")}</strong></p>
    <label htmlFor={`${inputId}-source`}>{imageMode ? t("Kiindulókép a galériából") : t("Alapvideó a galériából")}</label>
    <select id={`${inputId}-source`} value={source?.id ?? ""} disabled={locked} onChange={event => {
      const item = props.gallery.find(item => item.assetId === event.target.value);
      invalidate(); setSource(item?.url ? { id: item.assetId, url: item.url } : null);
    }}>
      <option value="">{imageMode ? t("Válassz képet vagy tölts fel sajátot") : t("Válassz videót vagy tölts fel sajátot")}</option>
      {source && !props.gallery.some(item => item.assetId === source.id) && <option value={source.id}>{t("Saját feltöltött")}{" "}{imageMode ? t("kép") : t("videó")}</option>}
      {props.gallery.filter(item => item.mediaType === (imageMode ? "image" : "video") && item.url && item.characterId === props.characterId)
        .map((item, index) => <option key={item.assetId} value={item.assetId}>{imageMode ? t("Modellkép") : t("Modellvideó")} {index + 1}</option>)}
    </select>
    <button type="button" className="ghost" disabled={locked || !props.characterId} style={{ marginTop: 8 }} onClick={async () => {
      setMessage("");
      const uploader = imageMode ? props.uploadImage : props.uploadVideo;
      await uploader?.((id, file) => {
        invalidate();
        if (localPreview.current) URL.revokeObjectURL(localPreview.current);
        localPreview.current = URL.createObjectURL(file);
        setSource({ id, url: localPreview.current });
        setMessage(imageMode ? t("Kiindulókép feltöltve.") : t("Saját alapvideó feltöltve."));
      });
    }}>{imageMode ? t("Saját kiindulókép feltöltése (JPG / PNG / WebP, max. 4 MB)") : t("Saját modellvideó feltöltése (MP4, max. 48 MB)")}</button>
    {source && (imageMode ? (
      /* eslint-disable-next-line @next/next/no-img-element -- user-selected source preview */
      <img src={source.url} alt={t("Beszélő videó kiinduló modellképe")} style={{ display: "block", maxWidth: "100%", maxHeight: 420, marginTop: 12 }} />
    ) : <video key={source.id} src={source.url} controls playsInline preload="metadata"
      style={{ display: "block", maxWidth: "100%", maxHeight: 380, marginTop: 12 }} />)}
    <p className="muted">{imageMode
      ? t("Egyetlen, jól látható arcot ábrázoló képet válassz; félalakos képen a gesztusok is jobban látszanak. A képet vágás nélkül 9:16 keretbe illesztjük. Végig ugyanaz a személy szerepel, rögzített kamerával és zoom nélkül. A beszéd legfeljebb 3 perces lehet.")
      : t("Legfeljebb 3 perces, egy jól látható beszélővel készült videót használj. Az új videó a teljes beszéd hosszához igazodik: ha rövid az alap, a mozgása ismétlődik; ha hosszabb, a végét levágjuk. A beszédet nem csonkítjuk, és nem gyorsítjuk fel erőltetetten.")}</p>
    {imageMode && <p><button type="button" className="ghost" disabled={locked} onClick={() => {
      invalidate(); setText(TALKING_COMMENT_SCRIPT); setDelivery("curious"); setMotion("natural");
    }}>{t("Kommentindító minta · megélhetés + VagyokRád + Telegram")}</button></p>}
    <label htmlFor={`${inputId}-text`}>{t("Mit mondjon a modell?")}</label>
    <textarea id={`${inputId}-text`} maxLength={REDUB_MAX_TEXT} value={text} disabled={locked}
      placeholder={t("Másold be a teljes szöveget, például: Story timeee!…")}
      onChange={event => { invalidate(); setText(event.target.value); }}
      style={{ width: "100%", minHeight: 170, display: "block", marginTop: 6 }} />
    <p className="muted">{text.length}/{REDUB_MAX_TEXT}{" "}{t("karakter · A tényleges hossz a kész hang meghallgatásakor látható.")}</p>
    <label htmlFor={`${inputId}-delivery`}>{imageMode ? t("Hangulat és előadásmód") : t("Előadásmód")}</label>
    <select id={`${inputId}-delivery`} value={delivery} disabled={locked} onChange={event => { invalidate(); setDelivery(event.target.value as RedubDelivery); }}>
      <option value="girly">{t("Csajos, vidám TikTok-előadás")}</option>
      <option value="natural">{t("Természetes, beszélgetős")}</option>
      <option value="energetic">{t("Lendületes, lelkes")}</option>
      <option value="story">{t("Mesélős, közvetlen")}</option>
      <option value="curious">{t("Kíváncsi, beszélgetést indító")}</option>
      <option value="serious">{t("Komoly, elgondolkodó")}</option>
      <option value="confident">{t("Magabiztos, nyugodt")}</option>
    </select>
    {imageMode && <div style={{ marginTop: 12 }}>
      <label htmlFor={`${inputId}-motion`}>{t("Mozgás és gesztusok")}</label>
      <select id={`${inputId}-motion`} value={motion} disabled={locked} onChange={event => { invalidate(); setMotion(event.target.value as TalkingMotion); }}>
        <option value="subtle">{t("Visszafogott · finom mimika")}</option>
        <option value="natural">{t("Természetes · laza beszélgetés")}</option>
        <option value="expressive">{t("Élénkebb · több gesztus")}</option>
      </select>
      <label htmlFor={`${inputId}-resolution`}>{t("Videó minősége")}</label>
      <select id={`${inputId}-resolution`} value={resolution} disabled={locked} onChange={event => { invalidate(); setResolution(event.target.value as "480p" | "720p"); }}>
        <option value="720p">{t("720p · részletesebb videó")}</option>
        <option value="480p">{t("480p · kedvezőbb ár")}</option>
      </select>
    </div>}
    <h3>{t("1. Saját modellhang elkészítése és meghallgatása")}</h3>
    <p><button type="button" className="ghost" disabled={locked || !props.characterId} onClick={() => void restoreSpeech()}>{t("Legutóbbi elkészült hang visszatöltése · ingyenes")}</button></p>
    <button type="button" className="ghost" disabled={locked || !props.characterId || !text.trim()} onClick={() => void quote("speech")}>{t("Hangkészítés árának lekérése")}</button>
    {speechQuote?.key === signature && <button type="button" disabled={locked} style={{ marginLeft: 8 }} onClick={() => {
      setSpeechSignature(signature); setVideoQuote(null);
      props.onRun("speech", { videoRedubSpeech: true, text: text.trim(), delivery });
    }}>{t("Hang készítése ·")}{" "}{speechQuote.credits}{" "}{t("kredit")}</button>}
    {props.speechJob && <p className="muted" role="status">{t("Hang:")}{" "}{t(props.speechJob.status)}</p>}
    {ready && <audio key={props.speechJob?.id} src={audio!.url!} controls preload="metadata" style={{ display: "block", width: "100%", marginTop: 10 }} />}
    {!ready && audio && <p className="muted">{t("Az új szöveghez vagy előadásmódhoz készíts új hangot.")}</p>}
    <h3>{imageMode ? t("2. Beszélő videó készítése a képből") : t("2. A jóváhagyott hanghoz igazított szájmozgás")}</h3>
    <button type="button" className="ghost" disabled={locked || !ready || !source} onClick={() => void quote("video")}>{imageMode ? t("Beszélő videó árának és hosszának lekérése") : t("Szájszinkron árának és hosszának lekérése")}</button>
    {ready && videoQuote?.key === videoKey && <>
      <p>{t("A kész videó kb.")}{" "}<strong>{videoQuote.speechSeconds}{" "}{t("másodperc")}</strong>. {imageMode ? t("A teljes, meghallgatott beszédhez készül a mimika és a mozgás.") : <>{t("Alapvideó:")}{" "}{videoQuote.sourceSeconds}{" "}{t("másodperc.")}{Number(videoQuote.speechSeconds) > Number(videoQuote.sourceSeconds) ? t(" A felvétel ismétlődik, hogy a teljes szöveg beleférjen.") : t(" A felvétel a beszéd végén ér véget.")}</>}</p>
      <button type="button" disabled={locked} onClick={() => props.onRun("video", videoPayload)}>{imageMode ? t("Képből beszélő videó készítése") : t("Videó készítése szájszinkronnal")} · {videoQuote.credits}{" "}{t("kredit")}</button>
    </>}
    {props.videoJob && <p className="muted" role="status">{t("Szájszinkron:")}{" "}{t(props.videoJob.status)}</p>}
    {(message || props.message) && <p className="muted" role="status">{message || props.message}</p>}
    {props.videoResults.filter(item => item.mediaType === "video" && item.url).map(item => <div key={item.assetId} style={{ marginTop: 12 }}>
      <video src={item.url!} controls playsInline style={{ maxWidth: "100%", maxHeight: 600 }} />
      <p><a href={item.url!} download>{t("Videó letöltése")}</a> · <a href="/gallery">{t("Megnyitás a galériában")}</a></p>
    </div>)}
    <p className="muted">{t("A kész videóban ellenőrizd az arcot, a kiejtést és a szájmozgást. A hangkészítés és a szájszinkron külön, a fenti gombokon jelzett kredittel jár.")}</p>
  </section>;
}
