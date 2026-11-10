"use client";
import JobProgress from '@/components/jobs/JobProgress';
import type { ProgressInput } from '@/lib/jobs/progress';
import { creationPricingText } from "@/lib/billing/creationAvailability";
import { useAppTranslation } from "@/components/i18n/AppLanguageProvider";
// AI eszközök – minden eszköz VALÓDI folyamattal: assetválasztó/feltöltés, paraméterek,
// árbecslés, indítás, progress, eredmény (player/letöltés/galéria), retry.
// (Kulccsal futtatva valódi providert hív; kulcs nélkül NO_PROVIDER_CONFIGURED – nincs hamis eredmény.)
import { useCallback, useEffect, useRef, useState } from "react";
import { browserClient } from "@/lib/supabase/client";
import { JobPoller, TERMINAL_STATUSES } from "@/lib/jobs/poller";
import { createAttemptTracker, type AttemptTracker } from "@/lib/jobs/attemptKey";
import { createSubmitGuard, type SubmitGuard } from "@/lib/jobs/submitGuard";
import { guardedRun } from "@/lib/jobs/guardedRun";
import { startJobWithTracker } from "@/lib/jobs/startJob";
import VideoRedub from "@/components/VideoRedub";

interface GalItem { galleryItemId: string; assetId: string; mediaType: string; url: string | null; characterId?: string | null; }
interface CharacterRow { id: string; name: string; }
interface JobRow extends ProgressInput { id: string; status: string; error: { message?: string } | null; }
interface Res { assetId: string; galleryItemId: string; mediaType: string; url: string | null; motionPart?: { index: number; total: number } | null; }
interface Cfg { mode: string; faceSwapConfigured: boolean; i2vModels: Array<{ id: string; label: string }>; }
interface NuretaVideo { assetId: string; jobId: string; characterId: string; createdAt: string; duration: number; }

export default function ToolsPage() {
  const { t: translate, locale } = useAppTranslation();
  const translationRef = useRef(translate);
  translationRef.current = translate;
  const t = useCallback((source: string, variables?: Record<string, string | number>) => translationRef.current(source, variables), []);
  const [gallery, setGallery] = useState<GalItem[]>([]);
  const [approvedVideos, setApprovedVideos] = useState<GalItem[]>([]);
  const [characters, setCharacters] = useState<CharacterRow[]>([]);
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  const [jobs, setJobs] = useState<Record<string, JobRow>>({});
  const [results, setResults] = useState<Record<string, Res[]>>({});
  const [nuretaVideos, setNuretaVideos] = useState<NuretaVideo[]>([]);
  const [nuretaVideoAsset, setNuretaVideoAsset] = useState("");
  const [nuretaAudioMode, setNuretaAudioMode] = useState<"keep" | "model" | "speech">("keep");
  const [nuretaSpeech, setNuretaSpeech] = useState("");
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const pollerRef = useRef<JobPoller | null>(null);
  const trackersRef = useRef<Record<string, AttemptTracker>>({});
  const submittingRef = useRef<Record<string, SubmitGuard>>({});

  // per-eszköz bemenetek
  const [edAsset, setEdAsset] = useState(""); const [edPrompt, setEdPrompt] = useState("");
  const [vPrompt, setVPrompt] = useState("");
  const [vDuration, setVDuration] = useState("5"); const [vRatio, setVRatio] = useState("16:9");
  const [vModel, setVModel] = useState("");
  const [toolChar, setToolChar] = useState("");
  const [ttsText, setTtsText] = useState(""); const [ttsVoice, setTtsVoice] = useState("Jennifer (en)");
  const [simpleAsset, setSimpleAsset] = useState("");           // i2p/upscale/bgremoval/skin/fix
  const [swapAsset, setSwapAsset] = useState(""); const [swapPreview, setSwapPreview] = useState("");
  const [bulkFiles, setBulkFiles] = useState<File[]>([]);
  const [bulkCategory, setBulkCategory] = useState<"tiktok" | "fanvue">("tiktok");
  const [bulkStatus, setBulkStatus] = useState<Array<{ name: string; state: string; jobId?: string }>>([]);
  const bulkBusyRef = useRef(false);
  const [pinterestQuery, setPinterestQuery] = useState("");
  const [pinterestPins, setPinterestPins] = useState<Array<{ id: string; imageUrl: string; pinUrl: string }>>([]);
  const [pinterestMessage, setPinterestMessage] = useState("");
  const [swapPinUrl, setSwapPinUrl] = useState("");
  const [characterEditModel, setCharacterEditModel] = useState<"seedream-v4.5" | "nano-banana">("seedream-v4.5");
  const [talkVideo, setTalkVideo] = useState(""); const [talkAudio, setTalkAudio] = useState("");
  const [elevenVoices, setElevenVoices] = useState<Array<{ id: string; name: string }>>([]);
  const [elevenVoice, setElevenVoice] = useState("");
  const [elevenText, setElevenText] = useState("");
  const [v2vVideo, setV2vVideo] = useState(""); const [v2vPrompt, setV2vPrompt] = useState("");
  const [videoResolution, setVideoResolution] = useState<"480p" | "720p">("720p");
  const [motionQuality, setMotionQuality] = useState<"pro" | "standard">("pro");
  const [motionMethod, setMotionMethod] = useState<"anchored" | "legacy">("anchored");
  const [motionVoiceMode, setMotionVoiceMode] = useState<"model" | "original">("model");
  const [variationVideo, setVariationVideo] = useState("");
  const [variationStyle, setVariationStyle] = useState<"playful" | "confident" | "casual">("playful");
  const [sceneVideo, setSceneVideo] = useState("");
  const [sceneText, setSceneText] = useState("Nekem is van egy másik, vadabb énem. Aki azt mondja, hogy neki nincs, az hazudik. Én szeretem kiélni ezt az oldalamat is. Ha többet szeretnél látni belőlem, figyeld a sztorimat, és kövess be, mert ez még egy új fiók. Puszillak!");
  const [videoPreview, setVideoPreview] = useState("");
  const [motionStartMode, setMotionStartMode] = useState<"generated" | "upload">("generated");
  const [motionStartImage, setMotionStartImage] = useState<{ assetId: string; preview: string; characterId: string } | null>(null);
  const [scenePrompt, setScenePrompt] = useState("");
  const [sceneChoice, setSceneChoice] = useState<{ jobId: string; assetId: string; videoId: string; characterId: string } | null>(null);
  const [adultScenePrompt, setAdultScenePrompt] = useState("");
  const [adultSource, setAdultSource] = useState<{ id: string; mediaType: "image" | "video" } | null>(null);
  const [adultSourcePreview, setAdultSourcePreview] = useState("");
  const [adultVideoPrompt, setAdultVideoPrompt] = useState("");
  const [sceneVideoEngine, setSceneVideoEngine] = useState<"nureta" | "kling">("nureta");
  const [adultDuration, setAdultDuration] = useState<5 | 8 | 10 | 12 | 15>(5);
  const [adultResolution, setAdultResolution] = useState<"480p" | "720p">("480p");
  const [adultVoiceMode, setAdultVoiceMode] = useState<"source" | "model" | "nureta">("nureta");
  const [adultSpeechText, setAdultSpeechText] = useState("");
  const [adultChoice, setAdultChoice] = useState<{ jobId?: string; assetId: string; characterId: string; inputMode?: "upload" } | null>(null);

  const analysisRevision = useRef(0);
  const [videoAnalysisSummary, setVideoAnalysisSummary] = useState("");

  const chooseAdultSource = (id: string, mediaType: "image" | "video", preview: string) => {
    analysisRevision.current += 1;
    setAdultVideoPrompt("");
    setVideoAnalysisSummary("");
    setMsg(current => ({ ...current, videoAnalysis: "" }));
    setAdultSource({ id, mediaType });
    setAdultSourcePreview(preview);
    setAdultChoice(null);
    setResults((current) => ({ ...current, adultPreview: [], adultVideo: [] }));
    setAdultVoiceMode("nureta");
  };

  const getSb = () => browserClient();
  const token = useCallback(async () => (await getSb().auth.getSession()).data.session?.access_token ?? "", []);

  async function analyzeAdultSource() {
    if (adultSource?.mediaType !== "video" || busyKey !== null) return;
    const revision = ++analysisRevision.current;
    setBusyKey("videoAnalysis");
    setMsg(current => ({ ...current, videoAnalysis: t("Az AI elemzi a videó mozdulatait és a kameramozgást…") }));
    try {
      const response = await fetch("/api/nureta/video-prompt", {
        method: "POST", headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
        body: JSON.stringify({ videoAssetId: adultSource.id, duration: adultDuration }),
      });
      const data = await response.json() as { prompt?: string; summary?: string; sourceDuration?: number; error?: string };
      if (!response.ok || !data.prompt) throw new Error(data.error ?? t("Nem sikerült elemezni a videót."));
      if (revision !== analysisRevision.current) return;
      setAdultVideoPrompt(data.prompt);
      setVideoAnalysisSummary(data.summary ?? "");
      setMsg(current => ({ ...current, videoAnalysis: t("Prompt elkészült a {p0} másodperces videóhoz. Ellenőrizd, szükség esetén szerkeszd. A kezdőkép jóváhagyása után ezt használjuk.", {p0: adultDuration}) }));
    } catch (error) {
      if (revision === analysisRevision.current) setMsg(current => ({ ...current, videoAnalysis: error instanceof Error ? error.message : t("Elemzési hiba") }));
    } finally { setBusyKey(null); }
  }

  async function loadElevenVoices() {
    const response = await fetch("/api/elevenlabs/voices", { headers: { authorization: `Bearer ${await token()}` } });
    if (!response.ok) {
      setMsg((current) => ({ ...current, eleven: t("Az ElevenLabs hangok nem tölthetők be. Ellenőrizd a szerver API-kulcsát.") }));
      return;
    }
    const data = await response.json() as { voices: Array<{ id: string; name: string }> };
    setElevenVoices(data.voices);
    setElevenVoice((current) => current || data.voices.find((voice) => voice.name.toLocaleLowerCase("hu") === "laura")?.id
      || data.voices.find((voice) => voice.name.toLocaleLowerCase("hu").startsWith("laura"))?.id || data.voices[0]?.id || "");
  }

  async function generateElevenSpeech() {
    if (!elevenVoice || !elevenText.trim() || busyKey) return;
    setBusyKey("eleven");
    try {
      const response = await fetch("/api/elevenlabs/speech", {
        method: "POST", headers: { authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ voiceId: elevenVoice, text: elevenText.trim() }),
      });
      if (!response.ok) throw new Error(t("A hangkészítés nem sikerült. Ellenőrizd az ElevenLabs kreditet és a kiválasztott hangot."));
      const data = await response.json() as { assetId: string };
      setTalkAudio(data.assetId);
      setMsg((current) => ({ ...current, eleven: t("A hang elkészült és ki van választva a videóhoz.") }));
    } catch (error) {
      setMsg((current) => ({ ...current, eleven: error instanceof Error ? error.message : "Hanghiba" }));
    } finally { setBusyKey(null); }
  }

  const init = useCallback(async () => {
    const { data: { user } } = await getSb().auth.getUser();
    if (!user) return;
    const accessToken = await token();
    const [batchResponse, res, approvedResponse, lastVideoResult, charsResult, c, latestEditsResult] = await Promise.all([
      fetch("/api/jobs/batch", { headers: { authorization: `Bearer ${accessToken}` } }),
      fetch("/api/gallery", { headers: { authorization: `Bearer ${accessToken}` } }),
      fetch("/api/gallery?approvedVideos=1", { headers: { authorization: `Bearer ${accessToken}` } }),
      getSb().from("assets").select("id").eq("owner_id", user.id).eq("media_type", "video")
        .eq("source", "upload").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      getSb().from("characters").select("id,name").eq("owner_id", user.id).not("active_version_id", "is", null),
      fetch("/api/config/provider"),
      getSb().from("generation_jobs").select("id,status,error").eq("owner_id", user.id).eq("type", "character_swap")
        .not("character_id", "is", null).order("created_at", { ascending: false }).limit(50),
    ]);
    if (batchResponse.ok) {
      const batch = await batchResponse.json() as { items: Array<{ filename: string; status: string; job_id: string | null; jobStatus: string | null; error: string | null }> };
      setBulkStatus(batch.items.map((item) => ({
        name: item.filename, jobId: item.job_id ?? undefined,
        state: item.jobStatus ?? (item.status === "pending" || item.status === "claimed" ? t("sorban") : item.error ?? item.status),
      })));
    }
    if (res.ok) {
      const items = ((await res.json()) as { items: GalItem[] }).items.filter((i) => i.url);
      setGallery(items);
    }
    if (approvedResponse.ok) {
      const first = await approvedResponse.json() as { items: GalItem[]; total: number };
      const items = [...first.items];
      for (let page = 1; page < Math.ceil(first.total / 100); page++) {
        const next = await fetch(`/api/gallery?approvedVideos=1&page=${page}`, { headers: { authorization: `Bearer ${accessToken}` } });
        if (!next.ok) break;
        items.push(...((await next.json()) as { items: GalItem[] }).items);
      }
      const available = items.filter((i) => i.url);
      setApprovedVideos(available);
    }
    const { data: lastScene } = await getSb().from("generation_jobs")
      .select("id,status,payload,character_id").eq("owner_id", user.id)
      .eq("type", "character_motion_video").eq("status", "completed")
      .contains("payload", { motionMethod: "scene_preview" })
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (lastScene) {
      const sceneResult = await fetch(`/api/jobs/${lastScene.id}`, { headers: { authorization: `Bearer ${accessToken}` } });
      if (sceneResult.ok) {
        const sceneData = await sceneResult.json() as { results: Res[] };
        const image = sceneData.results.find((item) => item.mediaType === "image");
        const videoId = (lastScene.payload as { sourceVideoAssetId?: string } | null)?.sourceVideoAssetId;
        if (image?.assetId && videoId && lastScene.character_id) {
          setSceneChoice({ jobId: lastScene.id, assetId: image.assetId, videoId, characterId: lastScene.character_id });
          setResults((current) => ({ ...current, scenePreview: sceneData.results }));
        }
      }
    }
    const { data: lastAdultScene } = await getSb().from("generation_jobs")
      .select("id,character_id,payload").eq("owner_id", user.id).eq("type", "nureta_scene_image")
      .eq("status", "completed").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (lastAdultScene?.character_id) {
      const source = lastAdultScene.payload as { sourceAssetId?: string; sourceMediaType?: string } | null;
      if (source?.sourceAssetId && (source.sourceMediaType === "image" || source.sourceMediaType === "video"))
        setAdultSource((current) => current ?? { id: source.sourceAssetId!, mediaType: source.sourceMediaType as "image" | "video" });
      const { data: approvedScene } = await getSb().from("gallery_items").select("asset_id")
        .eq("job_id", lastAdultScene.id).eq("owner_id", user.id).eq("qc_status", "approved")
        .is("deleted_at", null).limit(1).maybeSingle();
      const latest = await fetch(`/api/jobs/${lastAdultScene.id}`, { headers: { authorization: `Bearer ${accessToken}` } });
      if (latest.ok) {
        const data = await latest.json() as { results: Res[] };
        const image = data.results.find((item) => item.mediaType === "image");
        if (image) {
          setJobs((current) => ({
            ...current, adultPreview: { id: lastAdultScene.id, status: "completed", error: null },
          }));
          if (approvedScene?.asset_id === image.assetId)
            setAdultChoice({ jobId: lastAdultScene.id, assetId: image.assetId, characterId: lastAdultScene.character_id });
          setResults((current) => ({ ...current, adultPreview: data.results }));
        }
      }
    }
    const { data: lastVideo } = lastVideoResult;
    if (lastVideo?.id) setV2vVideo((current) => current || lastVideo.id);
    const { data: latestMotion } = await getSb().from("generation_jobs").select("id,status,error")
      .eq("owner_id", user.id).eq("type", "character_motion_video").contains("payload", { motionMethod: "anchored" })
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (latestMotion) {
      setJobs(current => ({ ...current, modelMotion: { ...latestMotion, checked_at: Date.now() } as JobRow }));
      await loadJobResults(latestMotion.id, "modelMotion");
      if (["queued", "submitted", "processing", "retrying", "quality_check", "finalizing"].includes(latestMotion.status)) poll(latestMotion.id, "modelMotion");
    }
    const { data: chars } = charsResult;
    setCharacters((chars ?? []) as unknown as CharacterRow[]);
    const requestedCharacter = new URLSearchParams(window.location.search).get("characterId");
    const linkedCharacter = chars?.find((character) => character.id === requestedCharacter);
    if (linkedCharacter) setToolChar((current) => current || linkedCharacter.id);
    else if (chars?.length === 1) setToolChar((current) => current || chars[0].id);
    if (c.ok) { const j = await c.json() as Cfg; setCfg(j); if (j.i2vModels[0]) setVModel(j.i2vModels[0].id); }
    // A karakteres képszerkesztés állapota oldalváltás után is visszatölthető.
    const { data: latestEdits } = latestEditsResult;
    const latestEdit = latestEdits?.[0] as JobRow | undefined;
    if (latestEdit) {
      setJobs((current) => ({ ...current, fullSwap: { ...latestEdit, checked_at: Date.now() } }));
      // Only the current edit needs live status in this view. Older jobs are
      // finalized by the background worker; polling all 50 floods the API.
      if (["queued", "submitted", "processing", "retrying", "quality_check", "finalizing"].includes(latestEdit.status)) poll(latestEdit.id, "fullSwap");
      if (latestEdit.status === "completed") await loadJobResults(latestEdit.id, "fullSwap");
      let restored = 0;
      for (const edit of (latestEdits ?? []) as JobRow[]) {
        if (edit.status !== "refunded" || edit.error?.message !== "URL_HOST_NOT_ALLOWED") continue;
        const recovered = await fetch(`/api/jobs/${edit.id}/recover-face-swap`, {
          method: "POST", headers: { authorization: `Bearer ${await token()}` },
        });
        if (recovered.ok) {
          restored++;
          if (edit.id === latestEdit.id) await loadJobResults(edit.id, "fullSwap");
        }
      }
      if (restored > 0) {
        const updatedGallery = await fetch("/api/gallery", { headers: { authorization: `Bearer ${await token()}` } });
        if (updatedGallery.ok) setGallery(((await updatedGallery.json()) as { items: GalItem[] }).items.filter((i) => i.url));
        setMsg((current) => ({ ...current, fullSwap: t("{p0} korábbi kép helyreállítva a Galériában.", {p0: restored}) }));
      }
    }
  }, [token, t]);
  useEffect(() => {
    setSceneVideo("");
    setVariationVideo("");
    setMotionStartImage(null);
  }, [toolChar]);
  useEffect(() => { void init(); }, [init]);
  useEffect(() => {
    pollerRef.current ??= new JobPoller({ intervalMs: 8000, maxAttempts: 240, maxConsecutiveErrors: 3, isTerminal: (s) => TERMINAL_STATUSES.includes(s) });
    return () => pollerRef.current?.stopAll();
  }, []);
  useEffect(() => {
    const refresh = async () => {
      const accessToken = await token();
      if (!accessToken) return;
      const response = await fetch("/api/jobs/batch", { headers: { authorization: `Bearer ${accessToken}` } });
      if (!response.ok) return;
      const batch = await response.json() as { items: Array<{ filename: string; status: string; job_id: string | null; jobStatus: string | null; error: string | null }> };
      if (batch.items.length) setBulkStatus(batch.items.map((item) => ({
        name: item.filename, jobId: item.job_id ?? undefined,
        state: item.jobStatus ?? (item.status === "pending" || item.status === "claimed" ? t("sorban") : item.error ?? item.status),
      })));
    };
    const timer = window.setInterval(() => { if (!bulkBusyRef.current) void refresh(); }, 15000);
    return () => window.clearInterval(timer);
  }, [token, t]);

  async function loadJobResults(jobId: string, key: string) {
    const res = await fetch(`/api/jobs/${jobId}`, { headers: { authorization: `Bearer ${await token()}` } });
    if (!res.ok) return;
    const b = await res.json() as { results: Res[]; job: { result?: { meta?: { caption?: string } } | null } };
    setResults((m) => ({ ...m, [key]: b.results }));
    const cap = b.job.result?.meta?.caption;
    if (cap) setCaptions((m) => ({ ...m, [key]: cap }));
  }
  useEffect(() => {
    let active = true;
    setNuretaVideos([]); setNuretaVideoAsset("");
    if (!toolChar) return;
    void (async () => {
      const res = await fetch(`/api/nureta/videos?characterId=${encodeURIComponent(toolChar)}`,
        { headers: { authorization: `Bearer ${await token()}` } });
      if (!active) return;
      if (!res.ok) { setMsg(current => ({ ...current, nuretaSync: t("A Nureta-videók listája nem tölthető be.") })); return; }
      const body = await res.json() as { items: NuretaVideo[] };
      if (!active) return;
      setNuretaVideos(body.items); setNuretaVideoAsset(body.items[0]?.assetId ?? "");
    })();
    return () => { active = false; };
  }, [toolChar, token, results.adultVideo, t]);
  function poll(jobId: string, key: string) {
    pollerRef.current?.stop(jobId);
    pollerRef.current?.start(jobId,
      async () => {
        // A webhook késhet; a már benyújtott provider-feladatot szerveren lekérdezzük.
        await fetch(`/api/jobs/${jobId}/refresh`, {
          method: "POST", headers: { authorization: `Bearer ${await token()}` },
        });
        const { data } = await getSb().from("generation_jobs").select("status,error,type,queued_at,started_at,created_at,provider_meta").eq("id", jobId).single();
        const sequence = data?.provider_meta as { motionSequence?: boolean; index?: number; segments?: unknown[]; parts?: unknown[] } | null;
        if (sequence?.motionSequence && data?.status === "processing") {
          setMsg(current => ({ ...current, [key]: t("{p0}/{p1}. videórész készül. {p2} rész már a galériában. A folytatás automatikus, az oldalt bezárhatod.", {p0: Math.min((sequence.index ?? 0) + 1, sequence.segments?.length ?? 1), p1: sequence.segments?.length ?? 1, p2: sequence.parts?.length ?? 0}) }));
          if (sequence.parts?.length) await loadJobResults(jobId, key);
        }
        const j = data as { status: string; error: { message?: string } | null; result: { meta?: { caption?: string } } | null } | null;
        return { status: j?.status ?? "unknown", error: j?.error?.message ?? null, progress: data ? { ...data, checked_at: Date.now() } : undefined };
      },
      async (_id, status, error, progress) => {
        const errorMessage = typeof error === "string" && error.length > 0 ? error : null;
        setJobs((m) => ({ ...m, [key]: { ...progress, id: jobId, status, error: errorMessage ? { message: errorMessage } : null } }));
        if (status === "failed" || status === "refunded" || status === "submission_uncertain") {
          setMsg(current => ({ ...current, [key]: status === "refunded"
            ? t("A generálás nem indult el vagy meghiúsult; a kreditet visszaadtuk. {p0}", {p0: errorMessage ?? ""})
            : status === "submission_uncertain" ? t("A beküldés állapotát ellenőrizni kell. {p0}", {p0: errorMessage ?? ""})
            : t("A generálás meghiúsult. {p0}", {p0: errorMessage ?? ""}) }));
        }
        if (status === "completed") {
          setMsg(current => ({ ...current, [key]: t("Elkészült, az eredmény a Galériában is megtalálható.") }));
          await loadJobResults(jobId, key); void init();
        }
      });
  }

  async function upload(accept: string, onFile?: (file: File) => void, maxBytes?: number): Promise<string | null> {
    const input = document.createElement("input");
    input.type = "file"; input.accept = accept;
    const file = await new Promise<File | null>((r) => { input.onchange = () => r(input.files?.[0] ?? null); input.oncancel = () => r(null); input.click(); });
    if (!file) return null;
    if (maxBytes && file.size > maxBytes) {
      setMsg(current => ({ ...current, upload: t("Ehhez a feltöltéshez legfeljebb {p0} MB méretű képet válassz.", {p0: Math.floor(maxBytes / 1024 / 1024)}) }));
      return null;
    }
    const form = new FormData(); form.append("file", file);
    const res = await fetch("/api/assets/import", { method: "POST", headers: { authorization: `Bearer ${await token()}` }, body: form });
    if (!res.ok) { setMsg((m) => ({ ...m, upload: t("Import hiba") })); return null; }
    onFile?.(file);
    return ((await res.json()) as { assetId: string }).assetId;
  }

  async function uploadVideo(onUploaded?: (id: string, file: File) => void) {
    const picker = document.createElement("input");
    picker.type = "file"; picker.accept = "video/mp4,.mp4";
    const file = await new Promise<File | null>((resolve) => { picker.onchange = () => resolve(picker.files?.[0] ?? null); picker.click(); });
    if (!file) return;
    setBusyKey("videoUpload");
    setMsg((m) => ({ ...m, videoUpload: t("Videó feltöltése…") }));
    try {
      if (file.type !== "video/mp4" || file.size < 1 || file.size > 48 * 1024 * 1024)
        throw new Error(t("MP4 videót válassz, legfeljebb 48 MB méretben."));
      const headers = { authorization: `Bearer ${await token()}`, "content-type": "application/json" };
      const signed = await fetch("/api/assets/video-upload", { method: "POST", headers,
        body: JSON.stringify({ contentType: file.type, size: file.size }) });
      const sign = await signed.json() as { objectPath?: string; token?: string; error?: string };
      if (!signed.ok || !sign.objectPath || !sign.token) throw new Error(sign.error ?? t("Feltöltési hiba"));
      const uploaded = await getSb().storage.from("assets").uploadToSignedUrl(sign.objectPath, sign.token, file, { contentType: file.type });
      if (uploaded.error) throw new Error(uploaded.error.message);
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const sha256 = Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");
      const finalized = await fetch("/api/assets/video-upload", { method: "PUT", headers,
        body: JSON.stringify({ objectPath: sign.objectPath, sha256 }) });
      const result = await finalized.json() as { assetId?: string; error?: string };
      if (!finalized.ok || !result.assetId) throw new Error(result.error ?? t("Nem sikerült menteni a videót."));
      if (onUploaded) onUploaded(result.assetId, file);
      else {
        setV2vVideo(result.assetId);
        setVideoPreview(URL.createObjectURL(file));
      }
      setMsg((m) => ({ ...m, videoUpload: t("Videó feltöltve. Válassz modellt, majd indítsd az átalakítást.") }));
    } catch (error) {
      setMsg((m) => ({ ...m, videoUpload: error instanceof Error ? error.message : t("Feltöltési hiba") }));
    } finally { setBusyKey(null); }
  }

  async function startBulkEdits(allModels = false) {
    if (bulkBusyRef.current || !bulkFiles.length || (!allModels && !toolChar) || (allModels && !characters.length) || !cfg?.faceSwapConfigured) return;
    bulkBusyRef.current = true;
    setBusyKey("bulkSwap");
    setBulkStatus(bulkFiles.map((file) => ({ name: file.name, state: t("várakozik") })));
    const update = (index: number, change: Partial<{ name: string; state: string; jobId: string }>) =>
      setBulkStatus((current) => current.map((row, i) => i === index ? { ...row, ...change } : row));
    let queuedSources = 0;
    try {
      const accessToken = await token();
      if (!accessToken) throw new Error(t("Jelentkezz be újra a feltöltéshez."));
      const uploadedFiles: Array<{ assetId: string; name: string }> = [];
      const enqueue = async (part: Array<{ assetId: string; name: string }>) => {
        const response = await fetch("/api/jobs/batch", {
          method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
          body: JSON.stringify({ ...(allModels ? { characterIds: characters.map((c) => c.id) } : { characterId: toolChar }), editModel: characterEditModel, contentCategory: bulkCategory, files: part }),
        });
        if (!response.ok) {
          const detail = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(t("{p0} forráskép sorban; a következő adag hibája: {p1}. A teljes csomagot ne indítsd újra.", {p0: queuedSources, p1: detail?.error ?? response.status}));
        }
        queuedSources += part.length;
        setMsg((current) => ({ ...current, bulkSwap: t("{p0}/{p1} forráskép sorba állítva…", {p0: queuedSources, p1: bulkFiles.length}) }));
      };
      for (let i = 0; i < bulkFiles.length; i++) {
        const file = bulkFiles[i];
        update(i, { state: t("feltöltés") });
        try {
          const form = new FormData(); form.append("file", file);
          const uploaded = await fetch("/api/assets/import", { method: "POST", headers: { authorization: `Bearer ${accessToken}` }, body: form });
          const imported = await uploaded.json() as { assetId?: string; error?: string };
          if (!uploaded.ok || !imported.assetId) throw new Error(imported.error ?? t("Feltöltési hiba"));
          uploadedFiles.push({ assetId: imported.assetId, name: file.name });
          update(i, { state: t("feltöltve") });
        } catch (error) {
          update(i, { state: t("Hiba: {p0}", { p0: error instanceof Error ? error.message : t("ismeretlen hiba") }) });
        }
        if (uploadedFiles.length - queuedSources >= 5) await enqueue(uploadedFiles.slice(queuedSources, queuedSources + 5));
      }
      if (uploadedFiles.length) {
        if (uploadedFiles.length > queuedSources) await enqueue(uploadedFiles.slice(queuedSources));
        setBulkStatus(allModels ? characters.flatMap((c) => uploadedFiles.map((f) => ({ name: `${c.name} · ${f.name}`, state: "sorban" })))
          : uploadedFiles.map((f) => ({ name: f.name, state: "sorban" })));
        setMsg((current) => ({ ...current, bulkSwap: t("{p0} forráskép × {p1} modell = {p2} {p3} kép sorba állítva. Most már elhagyhatod vagy frissítheted az oldalt.", {p0: uploadedFiles.length, p1: allModels ? characters.length : 1, p2: uploadedFiles.length * (allModels ? characters.length : 1), p3: bulkCategory === "fanvue" ? "Fanvue" : "TikTok"}) }));
        setBulkFiles([]);
        const picker = document.getElementById("character-source-images") as HTMLInputElement | null;
        if (picker) picker.value = "";
      }
    } catch (error) {
      setMsg((current) => ({ ...current, bulkSwap: error instanceof Error ? error.message : t("Hiba történt") }));
      if (queuedSources > 0) {
        setBulkFiles([]);
        const picker = document.getElementById("character-source-images") as HTMLInputElement | null;
        if (picker) picker.value = "";
      }
    } finally {
      bulkBusyRef.current = false;
      setBusyKey(null);
    }
  }

  async function recoverBulkEdits(allModels = false) {
    if (bulkBusyRef.current || (!allModels && !toolChar) || (allModels && !characters.length) || !cfg?.faceSwapConfigured) return;
    bulkBusyRef.current = true;
    setBusyKey("bulkSwap");
    try {
      const accessToken = await token();
      if (!accessToken) throw new Error(t("Jelentkezz be újra."));
      const recovered = await fetch("/api/jobs/batch/recover", { headers: { authorization: `Bearer ${accessToken}` } });
      if (!recovered.ok) throw new Error(t("A korábbi feltöltések lekérése nem sikerült."));
      const { items } = await recovered.json() as { items: Array<{ assetId: string; name: string }> };
      if (!items.length) {
        setMsg((current) => ({ ...current, bulkSwap: t("Nincs sorba nem állított kép az elmúlt 48 órából.") }));
        return;
      }
      let queued = 0;
      for (let offset = 0; offset < items.length; offset += 20) {
        const response = await fetch("/api/jobs/batch", {
          method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
          body: JSON.stringify({ ...(allModels ? { characterIds: characters.map((c) => c.id) } : { characterId: toolChar }), editModel: characterEditModel, contentCategory: bulkCategory, files: items.slice(offset, offset + 20) }),
        });
        if (!response.ok) {
          const detail = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(t("{p0}/{p1} kép sorban. A következő adag hibája: {p2}. Az elkészült adagokat ne indítsd újra.", {p0: queued, p1: items.length, p2: detail?.error ?? response.status}));
        }
        queued += Math.min(20, items.length - offset);
        setMsg((current) => ({ ...current, bulkSwap: t("{p0}/{p1} korábbi kép sorba állítva…", {p0: queued, p1: items.length}) }));
      }
      setMsg((current) => ({ ...current, bulkSwap: t("{p0} korábbi kép × {p1} modell sorba állítva a {p2} galériához.", {p0: items.length, p1: allModels ? characters.length : 1, p2: bulkCategory === "fanvue" ? "Fanvue" : "TikTok"}) }));
      void init();
    } catch (error) {
      setMsg((current) => ({ ...current, bulkSwap: error instanceof Error ? error.message : t("Helyreállítási hiba") }));
    } finally {
      bulkBusyRef.current = false;
      setBusyKey(null);
    }
  }

  async function searchPinterest() {
    if (pinterestQuery.trim().length < 2) return;
    setPinterestMessage(t("Keresés…"));
    setPinterestPins([]);
    try {
      const res = await fetch(`/api/pinterest/search?q=${encodeURIComponent(pinterestQuery.trim())}`, {
        headers: { authorization: `Bearer ${await token()}` },
      });
      const data = await res.json() as { error?: string; pins?: Array<{ id: string; imageUrl: string; pinUrl: string }> };
      if (!res.ok) {
        setPinterestMessage(data.error === "PINTEREST_ACCESS_REQUIRED" || data.error === "PINTEREST_SEARCH_ACCESS_REQUIRED"
          ? t("A Pinterest kereséshez jóváhagyott Pinterest API hozzáférés szükséges.")
          : t("A Pinterest keresés most nem érhető el."));
        return;
      }
      setPinterestPins(data.pins ?? []);
      setPinterestMessage(data.pins?.length ? t("Válassz egy képet az átalakításhoz.") : t("Nincs találat."));
    } catch { setPinterestMessage(t("A Pinterest keresés most nem érhető el.")); }
  }

  function run(key: string, type: string, payload: Record<string, unknown>, extra?: { characterId?: string }) {
    if (!submittingRef.current[key]) submittingRef.current[key] = createSubmitGuard();
    void guardedRun({
      guard: submittingRef.current[key],
      setBusy: (b) => setBusyKey(b ? key : null),
      onError: (m) => { setPrices((p) => ({ ...p, [key]: null })); setMsg((p) => ({ ...p, [key]: m })); },
      fn: async () => {
        setMsg((p) => ({ ...p, [key]: "" }));
        if (!trackersRef.current[key]) trackersRef.current[key] = createAttemptTracker();
        const headers = { authorization: `Bearer ${await token()}`, "content-type": "application/json" };
        const bodyObj = { type, characterId: extra?.characterId, payload };
        const est = await fetch("/api/jobs/estimate", { method: "POST", headers, body: JSON.stringify(bodyObj) });
        if (!est.ok) {
          const detail = await est.json().catch(() => ({})) as { error?: string };
          throw new Error(detail.error === "CREATION_COST_UNAVAILABLE" ? creationPricingText[locale].costUnavailable
            : detail.error === "MOTION_DURATION_LIMIT" ? t("3 másodperc és 5 perc közötti mozgásvideót válassz. A hosszabb videó automatikusan több részben készül el.")
            : detail.error === "VIDEO_FORMAT_UNSUPPORTED" ? t("A videó nem olvasható. Legfeljebb 48 MB-os MP4 fájlt válassz.")
            : t("Az indítás előtti ellenőrzés nem sikerült: {p0}. A generálás nem indult el.", {p0: detail.error ?? est.status}));
        }
        const estBody = await est.json().catch(() => { throw new Error(t("Árbecslés-válasz feldolgozása sikertelen.")); });
        if (typeof (estBody as { credits?: number }).credits !== "number") throw new Error(t("Árbecslés-válasz érvénytelen."));
        setPrices((p) => ({ ...p, [key]: (estBody as { credits: number }).credits }));
        if (estBody.tariffVersion && !window.confirm(creationPricingText[locale].confirm.replace("{p0}", String(estBody.credits))))
          throw new Error(creationPricingText[locale].cancelled);
        const result = await startJobWithTracker({ tracker: trackersRef.current[key], fetchImpl: fetch, token: await token(), body: { ...bodyObj, maxCredits: estBody.credits } });
        if ("skipped" in result) throw new Error(t("A kérés már fut."));
        if (!result.ok) throw new Error(result.error ?? t("Hiba: {p0}", { p0: result.status }));
        return result;
      },
    }).then((r) => {
      if ("ok" in r && r.ok) {
        setJobs((p) => ({ ...p, [key]: { id: r.value.jobId!, status: "queued", checked_at: Date.now(), error: null } }));
        setMsg((p) => ({ ...p, [key]: t("A kérés sorba állítva. A kész eredmény a Galériába kerül.") }));
        poll(r.value.jobId!, key);
      }
    });
  }

  const Picker = ({ media, selected, onSelect, approvedOnly = false }: { media: string; selected: string; onSelect: (id: string) => void; approvedOnly?: boolean }) => (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
      {(approvedOnly ? approvedVideos.filter((g) => g.characterId === toolChar) : gallery).filter((g) => g.mediaType === media).map((g) => (
        <button key={g.galleryItemId} className="ghost" disabled={busyKey !== null} onClick={() => onSelect(g.assetId)}
          style={{ padding: 2, borderRadius: 8, outline: selected === g.assetId ? "2px solid var(--accent)" : "1px solid var(--border)" }}>
          {media === "video" ? (
            <video src={g.url ?? ""} style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6, display: "block" }} muted />
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element -- signed URL */
            <img src={g.url ?? ""} alt="" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6, display: "block" }} />
          )}
        </button>
      ))}
      {(approvedOnly ? approvedVideos.filter((g) => g.characterId === toolChar) : gallery).filter((g) => g.mediaType === media).length === 0 && <span className="muted">{approvedOnly ? t("Ehhez a modellhez még nincs Jó alapvideóként megjelölt videó.") : t("nincs {p0} a galériában – tölts fel", {p0: t(media === "video" ? "videó" : "kép")})}</span>}
      {approvedOnly && <a href={`/gallery?characterId=${encodeURIComponent(toolChar || "all")}`}
        style={{ flexBasis: "100%", marginTop: 8 }}>{t("Galéria megnyitása – nézd meg a videókat, majd a megfelelőn nyomd meg a „Jó alapvideó” gombot")}</a>}
      {media === "video" && selected && (approvedOnly ? approvedVideos : gallery).find((g) => g.assetId === selected && (!approvedOnly || g.characterId === toolChar))?.url && (
        <div style={{ flexBasis: "100%", marginTop: 8 }}>
          <span className="muted">{t("Kiválasztott alapvideó – nézd végig indítás előtt:")}</span>
          <video key={selected} controls playsInline preload="metadata"
            src={(approvedOnly ? approvedVideos : gallery).find((g) => g.assetId === selected)?.url ?? ""}
            style={{ display: "block", width: "min(100%, 260px)", maxHeight: 460, marginTop: 8, borderRadius: 8 }} />
        </div>
      )}
    </div>
  );
  const Badge = ({ k }: { k: string }) => jobs[k] ? <JobProgress job={jobs[k]} compact ownerFallback={<span className="badge">{t(jobs[k].status)}{jobs[k].error?.message ? ` – ${jobs[k].error.message}` : ""}</span>} /> : null;
  const Price = ({ k }: { k: string }) => <span className="badge">{t("ár:")}{" "}{prices[k] == null ? "–" : `${prices[k]} ${t("kredit")}`}</span>;
  const Results = ({ k, kind }: { k: string; kind: "image" | "video" | "text" }) => (
    <>
      {(results[k] ?? []).filter((r) => r.mediaType === kind).map((r) => (
        <div key={r.galleryItemId} style={{ marginTop: 10 }}>
          {r.motionPart && <p className="muted">{r.motionPart.index}/{r.motionPart.total}{t(". videórész")}</p>}
          {kind === "video" ? <video src={r.url ?? ""} controls style={{ width: "100%", borderRadius: 8 }} />
            : (
              /* eslint-disable-next-line @next/next/no-img-element -- signed URL */
              <img src={r.url ?? ""} alt="" style={{ width: "100%", borderRadius: 8 }} />
            )}
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <a href={r.url ?? "#"} download><button className="ghost" style={{ padding: "4px 10px" }}>{t("Letöltés")}</button></a>
            <a href="/gallery"><button className="ghost" style={{ padding: "4px 10px" }}>{t("Galéria")}</button></a>
          </div>
        </div>
      ))}
      {kind === "text" && captions[k] && <p className="muted" style={{ marginTop: 8 }}>{t("Prompt:")}{" "}{captions[k]}</p>}
    </>
  );

  return (
    <main style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>{t("AI eszközök")}</h1>
      <p className="muted">{t("Minden eszköz teljes folyamattal. Kulcs nélkül a job őszintén elutasítódik (NO_PROVIDER_CONFIGURED) – hamis eredmény nincs.")}</p>

      <div className="card" style={{ marginBottom: 12 }}>
        <label>{t("Karakter")}</label>
        <select value={toolChar} onChange={(e) => setToolChar(e.target.value)} style={{ width: "100%" }}>
          <option value="">{t("Nincs karakter")}</option>
          {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <p className="muted" style={{ marginBottom: 0 }}>{t("Válaszd ki, kinek kell szerepelnie az új képen.")}</p>
      </div>

      <VideoRedub mode="image" key={`image-${toolChar}`} characterId={toolChar} characterName={characters.find(c => c.id === toolChar)?.name ?? ""}
        token={token} gallery={gallery} busy={busyKey !== null} uploadVideo={uploadVideo}
        uploadImage={async callback => {
          setBusyKey("imageTalkUpload");
          setMsg(current => ({ ...current, imageTalkUpload: "" }));
          try {
            let file: File | undefined;
            const id = await upload("image/jpeg,image/png,image/webp", selected => { file = selected; }, 4 * 1024 * 1024);
            if (id && file) callback(id, file);
          } catch (error) {
            setMsg(current => ({ ...current, imageTalkUpload: error instanceof Error ? error.message : t("Képfeltöltési hiba") }));
          } finally { setBusyKey(null); }
        }}
        restoreSpeech={async (jobId, characterId) => {
          const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { headers: { authorization: `Bearer ${await token()}` } });
          const data = await response.json() as { job?: { id: string; status: string; type: string }; results?: Res[] };
          if (!response.ok || data.job?.status !== "completed" || data.job.type !== "tts" || !data.results?.some(item => item.mediaType === "audio" && item.url))
            throw new Error(t("Az elkészült hang nem érhető el."));
          const key = `imageTalkSpeech:${characterId}`;
          setResults(current => ({ ...current, [key]: data.results! }));
          setJobs(current => ({ ...current, [key]: { id: jobId, status: "completed", error: null } }));
          setMsg(current => ({ ...current, [key]: "", [`imageTalkVideo:${characterId}`]: "" }));
        }}
        speechJob={jobs[`imageTalkSpeech:${toolChar}`]} speechResults={results[`imageTalkSpeech:${toolChar}`] ?? []}
        videoJob={jobs[`imageTalkVideo:${toolChar}`]} videoResults={results[`imageTalkVideo:${toolChar}`] ?? []}
        message={msg[`imageTalkVideo:${toolChar}`] || msg[`imageTalkSpeech:${toolChar}`] || msg.imageTalkUpload || msg.upload}
        onRun={(stage, payload) => {
          const key = `${stage === "speech" ? "imageTalkSpeech" : "imageTalkVideo"}:${toolChar}`;
          setResults(current => ({ ...current, [key]: [] }));
          setJobs(current => { const next = { ...current }; delete next[key]; return next; });
          if (stage === "speech") {
            setResults(current => ({ ...current, [`imageTalkVideo:${toolChar}`]: [] }));
            setMsg(current => ({ ...current, [`imageTalkVideo:${toolChar}`]: "" }));
          }
          run(key, stage === "speech" ? "tts" : "talking_video", payload, { characterId: toolChar });
        }} />

      <VideoRedub key={toolChar} characterId={toolChar} characterName={characters.find(c => c.id === toolChar)?.name ?? ""}
        token={token} gallery={gallery} busy={busyKey !== null} uploadVideo={uploadVideo}
        restoreSpeech={async (jobId, characterId) => {
          const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { headers: { authorization: `Bearer ${await token()}` } });
          const data = await response.json() as { job?: { id: string; status: string; type: string }; results?: Res[] };
          if (!response.ok || data.job?.status !== "completed" || data.job.type !== "tts" || !data.results?.some(item => item.mediaType === "audio" && item.url))
            throw new Error(t("Az elkészült hang nem érhető el."));
          const key = `redubSpeech:${characterId}`;
          setResults(current => ({ ...current, [key]: data.results! }));
          setJobs(current => ({ ...current, [key]: { id: jobId, status: "completed", error: null } }));
          setMsg(current => ({ ...current, [key]: "", [`redubVideo:${characterId}`]: "" }));
        }}
        speechJob={jobs[`redubSpeech:${toolChar}`]} speechResults={results[`redubSpeech:${toolChar}`] ?? []}
        videoJob={jobs[`redubVideo:${toolChar}`]} videoResults={results[`redubVideo:${toolChar}`] ?? []}
        message={msg[`redubVideo:${toolChar}`] || msg[`redubSpeech:${toolChar}`] || msg.videoUpload}
        onRun={(stage, payload) => {
          const key = `${stage === "speech" ? "redubSpeech" : "redubVideo"}:${toolChar}`;
          setResults(current => ({ ...current, [key]: [] }));
          setJobs(current => { const next = { ...current }; delete next[key]; return next; });
          if (stage === "speech") {
            setResults(current => ({ ...current, [`redubVideo:${toolChar}`]: [] }));
            setMsg(current => ({ ...current, [`redubVideo:${toolChar}`]: "" }));
          }
          run(key, stage === "speech" ? "tts" : "lip_sync", payload, { characterId: toolChar });
        }} />

      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>{adultChoice?.inputMode === "upload" ? t("Saját képből videó") : t("Jelenetkép jóváhagyása → videó")}</h2>
        <p className="muted">{t("Válassz képet vagy videót a galériából, vagy tölts fel újat. A forrás képének pózát, helyszínét és tárgyait megtartva a kiválasztott modell kerül rá. Videónál egy jól látható képkockát választunk.")}</p>
        <label>{t("Forráskép a galériából")}</label>
        <Picker media="image" selected={adultSource?.mediaType === "image" ? adultSource.id : ""}
          onSelect={(id) => chooseAdultSource(id, "image", gallery.find((g) => g.assetId === id)?.url ?? "")} />
        <label>{t("Forrásvideó a galériából")}</label>
        <Picker media="video" selected={adultSource?.mediaType === "video" ? adultSource.id : ""}
          onSelect={(id) => chooseAdultSource(id, "video", gallery.find((g) => g.assetId === id)?.url ?? "")} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <button className="ghost" disabled={busyKey !== null} onClick={async () => {
            let preview = "";
            const id = await upload("image/*", (file) => { preview = URL.createObjectURL(file); });
            if (id) chooseAdultSource(id, "image", preview);
          }}>{t("Kép feltöltése")}</button>
          <button className="ghost" disabled={busyKey !== null}
            onClick={() => void uploadVideo((id, file) => {
              chooseAdultSource(id, "video", URL.createObjectURL(file));
            })}>{t("Videó feltöltése (MP4)")}</button>
        </div>
        <button className="ghost" style={{ marginTop: 8 }} disabled={busyKey !== null || !toolChar} onClick={async () => {
          setBusyKey("adultUpload");
          try {
            let preview = "";
            const id = await upload("image/*", (file) => { preview = URL.createObjectURL(file); });
            if (!id) return;
            chooseAdultSource(id, "image", preview);
            setAdultChoice({ assetId: id, characterId: toolChar, inputMode: "upload" });
            setMsg((current) => ({ ...current, adultPreview: t("Saját kép kiválasztva. Közvetlenül ebből készül a videó.") }));
          } catch (error) {
            setMsg((current) => ({ ...current, upload: error instanceof Error ? error.message : t("Feltöltési hiba") }));
          } finally { setBusyKey(null); }
        }}>{t("Saját kép feltöltése közvetlen videókészítéshez")}</button>
        {(msg.videoUpload || msg.upload) && <p role="status" className="muted">{msg.videoUpload || msg.upload}</p>}
        {adultSource && <p className="muted">{t("Kiválasztott forrás:")}{" "}{adultSource.mediaType === "video" ? t("videó") : t("kép")}.</p>}
        {adultSourcePreview && adultSource?.mediaType === "image" && (
          /* eslint-disable-next-line @next/next/no-img-element -- user-selected local or signed URL */
          <img src={adultSourcePreview} alt={t("Kiválasztott forráskép")} style={{ maxWidth: "100%", maxHeight: 360, display: "block" }} />
        )}
        {adultSourcePreview && adultSource?.mediaType === "video" &&
          <video src={adultSourcePreview} controls playsInline style={{ maxWidth: "100%", maxHeight: 360, display: "block" }} />}
        {adultSource?.mediaType === "video" && <div style={{ marginTop: 12 }}>
          <label htmlFor="analysis-duration">{t("Az új videó hossza")}</label>
          <select id="analysis-duration" value={adultDuration} disabled={busyKey !== null}
            onChange={event => { analysisRevision.current += 1; setAdultDuration(Number(event.target.value) as 5 | 8 | 10 | 12 | 15); setVideoAnalysisSummary(""); }}>
            {[5, 8, 10, 12, 15].map(seconds => <option key={seconds} value={seconds}>{seconds}{" "}{t("mp")}</option>)}
          </select>
          <button className="ghost" disabled={busyKey !== null} onClick={() => void analyzeAdultSource()}>
            {busyKey === "videoAnalysis" ? t("Videó elemzése…") : t("Videó elemzése → prompt")}
          </button>
          <p className="muted">{t("Az AI a videó látható mozgását és kameráját írja le. Legfeljebb 30 mp / 48 MB. Rövidebb új videónál a forrás elejét követi. A Nureta új videót generál; a mozgás eltérhet.")}</p>
          {msg.videoAnalysis && <p className="muted" role="status">{msg.videoAnalysis}</p>}
          {videoAnalysisSummary && <p>{videoAnalysisSummary}</p>}
          <label htmlFor="analyzed-video-prompt">{t("Videóprompt (szerkeszthető)")}</label>
          <textarea id="analyzed-video-prompt" maxLength={1500} value={adultVideoPrompt} disabled={busyKey === "videoAnalysis"}
            onChange={event => setAdultVideoPrompt(event.target.value)} placeholder={t("Az elemzés ide tölti ki a mozdulatokat. Saját promptot is írhatsz.")} />
        </div>}
        {adultChoice?.inputMode !== "upload" && <>
        <label htmlFor="adult-scene">{t("Mit változtassunk a jelenetképen? (nem kötelező)")}</label>
        <textarea id="adult-scene" maxLength={500} value={adultScenePrompt}
          onChange={(event) => setAdultScenePrompt(event.target.value)} placeholder={t("Például: a modell arca legyen pontosabb; a póz és a tárgyak maradjanak")} />
        <button disabled={busyKey !== null || !toolChar || !adultSource} onClick={() => {
          setAdultChoice(null);
          setResults((current) => ({ ...current, adultPreview: [], adultVideo: [] }));
          run("adultPreview", "nureta_scene_image", {
            sourceAssetId: adultSource!.id, sourceMediaType: adultSource!.mediaType, scenePrompt: adultScenePrompt,
          }, { characterId: toolChar });
        }}>{t("Jelenetkép készítése / újragenerálása")}</button>
        <Badge k="adultPreview" /><Price k="adultPreview" />
        <Results k="adultPreview" kind="image" />
        {msg.adultPreview && <p role="status" className="muted">{msg.adultPreview}</p>}
        {results.adultPreview?.some((item) => item.mediaType === "image") && (
          <button className="ghost" disabled={busyKey !== null || !jobs.adultPreview?.id && !adultChoice} onClick={async () => {
            const image = results.adultPreview.find((item) => item.mediaType === "image");
            const jobId = jobs.adultPreview?.id ?? adultChoice?.jobId;
            if (!image || !jobId || !toolChar) return;
            setBusyKey("adultApprove");
            try {
              const response = await fetch("/api/nureta/scene/approve", {
                method: "POST", headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
                body: JSON.stringify({ jobId, assetId: image.assetId, characterId: toolChar }),
              });
              if (!response.ok) throw new Error(t("A jelenetkép jóváhagyása nem sikerült."));
              setAdultChoice({ jobId, assetId: image.assetId, characterId: toolChar });
              setMsg((current) => ({ ...current, adultPreview: t("Jelenetkép jóváhagyva. Add meg a videó szövegét.") }));
            } catch (error) {
              setMsg((current) => ({ ...current, adultPreview: error instanceof Error ? error.message : t("Jóváhagyási hiba") }));
            } finally { setBusyKey(null); }
          }}>{t("Ezt a jelenetképet jóváhagyom")}</button>
        )}
        </>}
        {adultChoice?.characterId === toolChar && (adultChoice.inputMode === "upload" || results.adultPreview?.some((item) => item.assetId === adultChoice.assetId)) && <>
          <p className="muted">{adultChoice.inputMode === "upload" ? t("Közvetlen videókészítés: add meg a mozgást, majd indítsd a videót.") : t("Jóváhagyott kép kiválasztva. A videó ebből a képből indul.")}</p>
          <label htmlFor="scene-video-engine">{t("Videómotor")}</label>
          <select id="scene-video-engine" value={sceneVideoEngine}
            onChange={(event) => setSceneVideoEngine(event.target.value as "nureta" | "kling")}>
            <option value="nureta">{t("Nureta / Seahorse")}</option>
            <option value="kling">{t("Kling 3.0 Pro / WaveSpeed")}</option>
          </select>
          <label htmlFor="adult-video-prompt">{t("Mit csináljon a videóban?")}</label>
          <textarea id="adult-video-prompt" maxLength={1500} value={adultVideoPrompt}
            onChange={(event) => setAdultVideoPrompt(event.target.value)} placeholder={t("Írd le a mozdulatokat és a jelenet menetét")} />
          <label htmlFor="adult-video-voice">{t("Videó hangja")}</label>
          <select id="adult-video-voice" value={adultVoiceMode}
            onChange={(event) => setAdultVoiceMode(event.target.value as "source" | "model" | "nureta")}>
            <option value="nureta">{t("Videómotor által készített hang")}</option>
            {adultSource?.mediaType === "video" && <option value="source">{t("Forrásvideó eredeti hangja")}</option>}
            <option value="model">{t("A kiválasztott modell hangja")}</option>
          </select>
          {adultVoiceMode === "model" && adultSource?.mediaType !== "video" && <>
            <label htmlFor="adult-speech">{t("Mit mondjon a modell? (magyar beszéd)")}</label>
            <textarea id="adult-speech" maxLength={adultDuration * 12} value={adultSpeechText}
              onChange={(event) => setAdultSpeechText(event.target.value)} />
            <p className="muted">{t("Rövid mondatot írj, amely belefér a választott")}{" "}{adultDuration}{" "}{t("másodpercbe.")}</p>
          </>}
          {adultVoiceMode === "model" && <p className="muted">{t("A karakterhez mentett ElevenLabs-hangot használjuk. A hangcsere önmagában nem szájmozgás-szinkron.")}</p>}
          {adultVoiceMode === "model" && adultSource?.mediaType === "video" &&
            <p className="muted">{t("A forrásvideó beszédét a modell hangjára cseréljük. A videóképet nem generáljuk újra a hangcsere során.")}</p>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select aria-label={t("Videó hossza")} value={adultDuration}
              onChange={(event) => { analysisRevision.current += 1; setAdultDuration(Number(event.target.value) as 5 | 8 | 10 | 12 | 15); setVideoAnalysisSummary(""); setMsg(current => ({ ...current, videoAnalysis: t("A videóhossz változott. A pontos időzítéshez futtasd újra az elemzést.") })); }}>
              {[5, 8, 10, 12, 15].map((seconds) => <option key={seconds} value={seconds}>{seconds}{" "}{t("mp")}</option>)}
            </select>
            <select disabled={sceneVideoEngine === "kling"} aria-label={t("Nureta felbontás")} value={adultResolution}
              onChange={(event) => setAdultResolution(event.target.value as "480p" | "720p")}>
              <option value="480p">{t("480p próba")}</option><option value="720p">{t("720p")}</option>
            </select>
            <button disabled={busyKey !== null || !adultVideoPrompt.trim()
              || adultVoiceMode === "model" && adultSource?.mediaType !== "video" && !adultSpeechText.trim()}
              onClick={() =>
              run("adultVideo", "nureta_scene_video", {
                prompt: adultVideoPrompt, videoEngine: sceneVideoEngine,
                ...(adultChoice.inputMode === "upload" ? { sceneInputMode: "upload" } : { sceneJobId: adultChoice.jobId }),
                sceneImageAssetId: adultChoice.assetId, duration: adultDuration, resolution: adultResolution,
                voiceMode: adultVoiceMode, speechText: adultSpeechText,
              }, { characterId: toolChar })}>{adultChoice.inputMode === "upload" ? t("Feltöltött képből videó készítése") : t("Jóváhagyott képből videó készítése")}</button>
          </div>
        </>}
        <Badge k="adultVideo" /><Price k="adultVideo" />
        <Results k="adultVideo" kind="video" />
        {msg.adultVideo && <p role="status" className="muted">{msg.adultVideo}</p>}
        <div style={{ marginTop: 24, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
          <h3>{t("Kész Nureta-videó → hang és szájszinkron")}</h3>
          <p className="muted">{t("Az elkészült videóból külön szinkronizált változat készül. Az eredeti megmarad; új Nureta-generálást nem indítunk. A szájszinkron külön kreditbe kerül.")}</p>
          <label htmlFor="nureta-sync-video">{t("Elkészült Nureta-videó")}</label>
          <select id="nureta-sync-video" value={nuretaVideoAsset} onChange={event => setNuretaVideoAsset(event.target.value)}>
            <option value="">{t("Válassz kész videót")}</option>
            {nuretaVideos.map(video => <option key={video.assetId} value={video.assetId}>
              {new Date(video.createdAt).toLocaleString(locale)} · {video.duration}{" "}{t("mp ·")}{" "}{video.jobId.slice(0, 8)}
            </option>)}
          </select>
          {nuretaVideos.length === 0 && <p className="muted">{t("Ehhez a modellhez még nincs elkészült Nureta-videó.")}</p>}
          <label htmlFor="nureta-sync-audio">{t("Hang a szinkronizált változatban")}</label>
          <select id="nureta-sync-audio" value={nuretaAudioMode} onChange={event => setNuretaAudioMode(event.target.value as "keep" | "model" | "speech")}>
            <option value="keep">{t("A kész videó meglévő hangja — csak szájszinkron")}</option>
            <option value="model">{t("A kész videó hangja a modell ElevenLabs-hangjára cserélve")}</option>
            <option value="speech">{t("Új magyar beszéd a modell ElevenLabs-hangján")}</option>
          </select>
          {nuretaAudioMode === "speech" && <>
            <label htmlFor="nureta-sync-speech">{t("Pontos kimondandó szöveg")}</label>
            <textarea id="nureta-sync-speech" maxLength={(nuretaVideos.find(v => v.assetId === nuretaVideoAsset)?.duration ?? 15) * 12}
              value={nuretaSpeech} onChange={event => setNuretaSpeech(event.target.value)} />
          </>}
          <p className="muted">{t("Ha a kész videó már a modell hangját használja, válaszd a „csak szájszinkron” lehetőséget. A beszédhez igazítjuk a szájat; sikítás vagy nevetés pontos szinkronja nem garantált.")}</p>
          <button disabled={busyKey !== null || !nuretaVideoAsset || nuretaAudioMode === "speech" && !nuretaSpeech.trim()}
            onClick={() => run("nuretaSync", "lip_sync", { nuretaPostprocess: true, videoAssetId: nuretaVideoAsset,
              audioMode: nuretaAudioMode, speechText: nuretaSpeech }, { characterId: toolChar })}>{t("Hang és szájszinkron készítése")}</button>
          <Badge k="nuretaSync" /><Price k="nuretaSync" />
          <Results k="nuretaSync" kind="video" />
          {msg.nuretaSync && <p role="status" className="muted">{msg.nuretaSync}</p>}
        </div>
      </section>

      <details className="card">
        <summary>{t("Image-to-Prompt (egyéb eszköz)")}</summary>
        <h3 style={{ marginTop: 0 }}>{t("Image-to-Prompt")}</h3>
        <Picker media="image" selected={simpleAsset} onSelect={setSimpleAsset} />
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button className="ghost" disabled={busyKey !== null} onClick={async () => { const id = await upload("image/*"); if (id) setSimpleAsset(id); }}>{t("Feltöltés")}</button>
          <input placeholder={t("asset ID")} value={simpleAsset} onChange={(e) => setSimpleAsset(e.target.value)} style={{ flex: 1 }} />
          <button disabled={busyKey === "i2p" || !simpleAsset} onClick={() => run("i2p", "video_to_prompt", { sourceAssetId: simpleAsset })}>{t("Prompt")}</button>
          <Badge k="i2p" /><Price k="i2p" />
        </div>
        <Results k="i2p" kind="text" />
        {msg.i2p && <p className="muted">{msg.i2p}</p>}
      </details>

      <div id="character-image" className="card" style={{ marginTop: 12, scrollMarginTop: 24 }}>
        <h3 style={{ marginTop: 0 }}>{characters.find((c) => c.id === toolChar)?.name ?? "Karakter"}{" "}{t("arca a feltöltött képen")}</h3>
        <p className="muted">{t("A kiválasztott karakter arca és haja automatikusan kerül a képre. A póz, a háttér és a tárgyak a feltöltött képhez igazodnak; telefon csak akkor maradhat a képen, ha a forrásképen is látszik.")}</p>
        <label>{t("Szerkesztő modell")}{" "}<select value={characterEditModel} onChange={(e) => setCharacterEditModel(e.target.value as "seedream-v4.5" | "nano-banana")}>
          <option value="seedream-v4.5">{t("Seedream 4.5 Edit")}</option>
          <option value="nano-banana">{t("Nano Banana Edit")}</option>
        </select></label>
        {cfg && !cfg.faceSwapConfigured && <p className="muted">{t("A WaveSpeed API-kulcs még nincs beállítva; az arccsere ezután válik elérhetővé.")}</p>}
        <label style={{ display: "block", margin: "12px 0 8px" }}>{t("Képek helye a galériában")}<select value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value as "tiktok" | "fanvue")} style={{ marginLeft: 8 }} disabled={busyKey !== null}>
            <option value="tiktok">{t("TikTok képek")}</option>
            <option value="fanvue">{t("Fanvue képek")}</option>
          </select>
        </label>
        <label htmlFor="character-source-images" style={{ display: "block", margin: "12px 0 8px" }}>{t("Átalakítandó képek tömeges feltöltése")}</label>
        <input id="character-source-images" type="file" accept="image/png,image/jpeg,image/webp,image/*"
          multiple disabled={busyKey !== null} aria-describedby="character-source-hint"
          onChange={(event) => {
            const selected = Array.from(event.currentTarget.files ?? []);
            setBulkFiles(selected);
            setBulkStatus([]);
            setSwapAsset(""); setSwapPinUrl(""); setSwapPreview("");
            setMsg((current) => ({ ...current, bulkSwap: "" }));
          }} />
        <p id="character-source-hint" className="muted">{t("A telefon fotóválasztójában több képet is jelölj ki, majd nyomd meg a Kész gombot.")}</p>
        <p className="muted">{t("A feltöltés befejezéséig maradj az oldalon. Amikor megjelenik a „sorba állítva” üzenet, a képek és videók az oldal bezárása után is feldolgozódnak.")}</p>
        {bulkFiles.length > 0 && <div role="status" style={{ margin: "8px 0 16px" }}>
          <p>{bulkFiles.length}{" "}{t("kép kiválasztva")}</p>
          <button disabled={busyKey !== null || !toolChar || !cfg?.faceSwapConfigured}
            onClick={() => void startBulkEdits()}>{t("Mind a")}{" "}{bulkFiles.length} {bulkCategory === "fanvue" ? "Fanvue" : "TikTok"}{" "}{t("kép elkészítése")}</button>
          <button className="ghost" style={{ marginLeft: 8 }} disabled={busyKey !== null || !characters.length || !cfg?.faceSwapConfigured}
            onClick={() => void startBulkEdits(true)}>{t("Készítés az összes modellre ·")}{" "}{bulkCategory === "fanvue" ? "Fanvue" : "TikTok"} ({bulkFiles.length * characters.length}{" "}{t("kép)")}</button>
        </div>}
        <div style={{ margin: "8px 0 16px" }}>
          <p className="muted">{t("Ha egy korábbi feltöltés megszakadt, válaszd ki fent a modellt és a galéria helyét, majd folytasd a már feltöltött képeket.")}</p>
          <button className="ghost" disabled={busyKey !== null || !toolChar || !cfg?.faceSwapConfigured}
            onClick={() => void recoverBulkEdits()}>{t("Korábbi feltöltések folytatása a kiválasztott modellre")}</button>
          <button className="ghost" style={{ marginLeft: 8 }} disabled={busyKey !== null || !characters.length || !cfg?.faceSwapConfigured}
            onClick={() => void recoverBulkEdits(true)}>{t("Korábbi feltöltések folytatása az összes modellre")}</button>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}> 
          <input aria-label={t("Pinterest keresés")} placeholder={t("Keresés Pinterest képek között…")} value={pinterestQuery}
            onChange={(e) => setPinterestQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void searchPinterest(); }} style={{ flex: 1, minWidth: 180 }} />
          <button className="ghost" disabled={pinterestQuery.trim().length < 2} onClick={() => void searchPinterest()}>{t("Pinterest keresés")}</button>
          <a href={`https://www.pinterest.com/search/pins/?q=${encodeURIComponent(pinterestQuery.trim())}`}
            target="_blank" rel="noopener noreferrer" className="ghost" style={{ padding: "10px 14px", textDecoration: "none" }}>{t("Megnyitás Pinteresten")}</a>
        </div>
        <p className="muted">{t("Ha a Pinterest kereséshez még nincs API-hozzáférés, nyisd meg a Pinterestet, mentsd le a kiválasztott képet, majd töltsd fel itt az „Átalakítandó kép feltöltése” gombbal.")}</p>
        {pinterestMessage && <p className="muted" role="status">{pinterestMessage}</p>}
        {pinterestPins.length > 0 && <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(125px, 1fr))" }}>
          {pinterestPins.map((pin) => <div key={pin.id}>
            {/* eslint-disable-next-line @next/next/no-img-element -- Pinterest CDN preview */}
            <img src={pin.imageUrl} alt={t("Pinterest találat")} style={{ width: "100%", height: 150, objectFit: "cover", borderRadius: 8 }} />
            <button className="ghost" disabled={busyKey !== null} onClick={() => { setSwapPinUrl(pin.imageUrl); setSwapAsset(""); setSwapPreview(pin.imageUrl); }}>{t("Ezzel készítem")}</button>
            <a href={pin.pinUrl} target="_blank" rel="noreferrer" style={{ display: "block" }}>{t("Megnyitás a Pinteresten")}</a>
          </div>)}</div>}
        {(swapAsset || swapPinUrl) && (swapPreview || gallery.find((item) => item.assetId === swapAsset)?.url) && (
          /* eslint-disable-next-line @next/next/no-img-element -- local preview or signed URL */
          <img src={swapPreview || gallery.find((item) => item.assetId === swapAsset)?.url || ""} alt={t("Átalakítandó kép előnézete")} style={{ display: "block", maxWidth: "100%", maxHeight: 350, objectFit: "contain", borderRadius: 8 }} />
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
          <button disabled={busyKey !== null || (!swapAsset && !swapPinUrl) || !toolChar || !cfg?.faceSwapConfigured}
            onClick={() => run("fullSwap", "character_swap", {
              ...(swapPinUrl ? { imageUrl: swapPinUrl } : { sourceAssetId: swapAsset }), useCharacterReference: true, editModel: characterEditModel,
            }, { characterId: toolChar })}>{characters.find((c) => c.id === toolChar)?.name ?? "Karakter"}{" "}{t("arcának behelyezése")}</button>
          <Badge k="fullSwap" /><Price k="fullSwap" />
        </div>
        <Results k="fullSwap" kind="image" />
        {msg.fullSwap && <p className="muted">{msg.fullSwap}</p>}
        <div style={{ borderTop: "1px solid var(--border)", marginTop: 20, paddingTop: 16 }}>
          <h4 style={{ margin: "0 0 8px" }}>{t("Tömeges feldolgozás állapota")}</h4>
          {msg.bulkSwap && <p role="status" className="muted">{msg.bulkSwap}</p>}
          {bulkStatus.length > 0 && <div role="status" style={{ marginTop: 12 }}>
            {bulkStatus.map((item, index) => <p key={`${index}-${item.name}`} style={{ margin: "4px 0" }}>
              {index + 1}. {item.name}: {item.jobId ? (jobs[`bulkSwap:${item.jobId}`]?.status ?? item.state) : item.state}
            </p>)}
          </div>}
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>{t("Upscale · Background Removal · Skin Enhancer · Fix Face")}</h3>
        <Picker media="image" selected={simpleAsset} onSelect={setSimpleAsset} />
        <input placeholder={t("asset ID")} value={simpleAsset} onChange={(e) => setSimpleAsset(e.target.value)} style={{ marginTop: 8 }} />
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <button className="ghost" disabled={busyKey !== null || !simpleAsset} onClick={() => run("up", "upscale", { sourceAssetId: simpleAsset })}>{t("Upscale")}</button>
          <button className="ghost" disabled={busyKey !== null || !simpleAsset} onClick={() => run("bg", "background_removal", { sourceAssetId: simpleAsset })}>{t("Háttér eltávolítás")}</button>
          <button className="ghost" disabled={busyKey !== null || !simpleAsset} onClick={() => run("skin", "skin_enhance", { sourceAssetId: simpleAsset })}>{t("Skin Enhancer")}</button>
          <button className="ghost" disabled={busyKey !== null || !simpleAsset} onClick={() => run("face", "fix_face", { sourceAssetId: simpleAsset })}>{t("Fix Face")}</button>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
          <Badge k="up" /><Price k="up" /><Badge k="bg" /><Price k="bg" /><Badge k="skin" /><Price k="skin" /><Badge k="face" /><Price k="face" />
        </div>
        <Results k="up" kind="image" /><Results k="bg" kind="image" /><Results k="skin" kind="image" /><Results k="face" kind="image" />
        {(msg.up || msg.bg || msg.skin || msg.face) && <p className="muted">{[msg.up, msg.bg, msg.skin, msg.face].filter(Boolean).join(" · ")}</p>}
      </div>

      <details className="card" style={{ marginTop: 12 }}>
        <summary>{t("Kézi hangkészítés vagy saját hang feltöltése (opcionális)")}</summary>
        <h3>{t("ElevenLabs-hang a modellvideóhoz")}</h3>
        <p className="muted">{t("Írd be a szöveget, válaszd ki az ElevenLabs-hangot, majd a kész modellvideóval indítsd a Lip Sync műveletet. Kész MP3/WAV hangot is feltölthetsz.")}</p>
        <button className="ghost" type="button" disabled={busyKey !== null} onClick={() => void loadElevenVoices()}>{t("ElevenLabs-hangok betöltése")}</button>
        {elevenVoices.length > 0 && <div style={{ marginTop: 8 }}>
          <select aria-label="ElevenLabs-hang" value={elevenVoice} onChange={(e) => setElevenVoice(e.target.value)}>
            {elevenVoices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}</option>)}
          </select>
          <textarea aria-label={t("Felmondandó szöveg")} maxLength={1500} placeholder={t("Mit mondjon a modell?")} value={elevenText}
            onChange={(e) => setElevenText(e.target.value)} style={{ display: "block", width: "100%", minHeight: 95, marginTop: 8 }} />
          <button type="button" disabled={busyKey !== null || !elevenText.trim()} onClick={() => void generateElevenSpeech()}>{t("Hang készítése")}</button>
        </div>}
        {msg.eleven && <p role="status" className="muted">{msg.eleven}</p>}
        <label>{t("Videó")}</label>
        <Picker media="video" selected={talkVideo} onSelect={setTalkVideo} />
        <input placeholder={t("videó asset ID")} value={talkVideo} onChange={(e) => setTalkVideo(e.target.value)} style={{ marginTop: 6 }} />
        <label>{t("Hang (mp3/wav)")}</label>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="ghost" disabled={busyKey !== null} onClick={async () => { const id = await upload("audio/mpeg,audio/wav"); if (id) setTalkAudio(id); }}>{t("Hang feltöltése")}</button>
          <input placeholder={t("hang asset ID")} value={talkAudio} onChange={(e) => setTalkAudio(e.target.value)} style={{ flex: 1 }} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
          <button disabled={busyKey === "talk" || !talkVideo || !talkAudio}
            onClick={() => run("talk", "talking_video", { videoAssetId: talkVideo, audioAssetId: talkAudio })}>{t("Talking Video")}</button>
          <button className="ghost" disabled={busyKey === "talk" || !talkVideo || !talkAudio}
            onClick={() => run("talk", "lip_sync", { videoAssetId: talkVideo, audioAssetId: talkAudio })}>{t("Lip Sync")}</button>
          <Badge k="talk" /><Price k="talk" />
        </div>
        <Results k="talk" kind="video" />
        {msg.talk && <p className="muted">{msg.talk}</p>}
      </details>

      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>{t("Video-to-Video · Image-to-Video")}</h3>
        <h4>{t("Szereplőcsere a feltöltött videóban")}</h4>
        <p className="muted">{t("A videó elejéről választott látható képkockán a kiválasztott modellre cseréljük a szereplőt, majd a forrásvideó mozgását használjuk. MP4, 3 másodperc–5 perc, legfeljebb 48 MB.")}</p>
        {motionMethod === "anchored" && <p className="muted">{t("A teljes forrásvideót legfeljebb 30 másodperces részekre bontjuk. Minden folytatás az előző elkészült rész utolsó képkockáját használja. A részek sorszámozva, külön kerülnek a Galériába; te vághatod össze őket. A generált részek hossza eltérhet a forrástól. A kreditár a teljes feldolgozott forrásra vonatkozik.")}</p>}
        <button className="ghost" type="button" disabled={busyKey !== null} onClick={() => void uploadVideo()}>{t("Mozgásvideó feltöltése (MP4, max. 48 MB)")}</button>
        {msg.videoUpload && <p className="muted">{msg.videoUpload}</p>}
        {videoPreview && <video controls src={videoPreview} style={{ display: "block", maxWidth: "100%", maxHeight: 320, marginTop: 8 }} />}
        {v2vVideo && <p className="muted">{t("Mozgásvideó kiválasztva. Fent válaszd ki a modellt.")}</p>}
        {motionMethod === "anchored" && <div style={{ marginTop: 12 }}>
          <label htmlFor="motion-start-mode">{t("Indulókép")}</label>
          <select id="motion-start-mode" value={motionStartMode} disabled={busyKey !== null}
            onChange={event => setMotionStartMode(event.target.value as "generated" | "upload")}>
            <option value="generated">{t("Jelenetkép generálása a videóból")}</option>
            <option value="upload">{t("Saját indulókép feltöltése")}</option>
          </select>
          {motionStartMode === "upload" && <>
            <p className="muted">{t("A videó ebből a képből indul, a mozgást a feltöltött mozgásvideó adja. A képet nem generáljuk újra. Korábbi videó képkockáját is feltöltheted.")}</p>
            <button className="ghost" type="button" disabled={busyKey !== null || !toolChar} onClick={async () => {
              setBusyKey("motionStartUpload");
              try {
                let preview = "";
                const id = await upload("image/*", file => { preview = URL.createObjectURL(file); });
                if (id) { setMotionStartImage({ assetId: id, preview, characterId: toolChar }); setMsg(current => ({ ...current, motionStart: t("Indulókép feltöltve. Ellenőrizd, majd indítsd a videót.") })); }
              } catch (error) {
                setMsg(current => ({ ...current, motionStart: error instanceof Error ? error.message : t("Képfeltöltési hiba") }));
              } finally { setBusyKey(null); }
            }}>{t("Saját indulókép feltöltése")}</button>
            {motionStartImage?.characterId === toolChar && (
              /* eslint-disable-next-line @next/next/no-img-element -- uploaded local preview */
              <img src={motionStartImage.preview} alt={t("Saját indulókép a mozgásvideóhoz")} style={{ display: "block", maxWidth: "100%", maxHeight: 360, marginTop: 8 }} />
            )}
            {msg.motionStart && <p className="muted" role="status">{msg.motionStart}</p>}
          </>}
        </div>}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
          <select aria-label={t("Videócsere minősége")} value={motionQuality} onChange={(e) => setMotionQuality(e.target.value as "pro" | "standard")}>
            <option value="pro">{t("Magas minőség · jobb arctartás")}</option><option value="standard">{t("Alap minőség")}</option>
          </select>
          <select aria-label={t("Videókészítés módja")} value={motionMethod} onChange={(e) => setMotionMethod(e.target.value as "anchored" | "legacy")}>
            <option value="anchored">{t("Jelenetkép + mozgás (új)")}</option>
            <option value="legacy">{t("Régi gyors szereplőcsere")}</option>
          </select>
          <label htmlFor="motion-voice-mode">{t("Videó hangja")}</label>
          <select id="motion-voice-mode" value={motionVoiceMode}
            onChange={(e) => setMotionVoiceMode(e.target.value as "model" | "original")}>
            <option value="original">{t("Eredeti videó hangja")}</option>
            <option value="model">{t("A kiválasztott modell hangja")}</option>
          </select>
          <button disabled={busyKey !== null || !toolChar || !v2vVideo
            || motionMethod === "anchored" && motionStartMode === "upload" && motionStartImage?.characterId !== toolChar} onClick={() => {
            if (motionMethod === "anchored" && motionStartMode === "upload") {
              if (!motionStartImage || motionStartImage.characterId !== toolChar) return;
              setResults(current => ({ ...current, modelMotion: [] }));
              run("modelMotion", "character_motion_video", { videoAssetId: v2vVideo, quality: motionQuality,
                motionMethod: "anchored", voiceMode: motionVoiceMode, sceneInputMode: "upload",
                sceneImageAssetId: motionStartImage.assetId }, { characterId: toolChar });
              return;
            }
            setSceneChoice(null);
            setResults((current) => ({ ...current, scenePreview: [] }));
            if (motionMethod === "anchored") {
              run("scenePreview", "character_motion_video", { videoAssetId: v2vVideo, quality: motionQuality,
                motionMethod: "scene_preview", scenePrompt, voiceMode: "original" }, { characterId: toolChar });
              return;
            }
            setResults((current) => ({ ...current, modelMotion: [] }));
            run("modelMotion", "character_motion_video", { videoAssetId: v2vVideo, quality: motionQuality, motionMethod,
              voiceMode: motionVoiceMode }, { characterId: toolChar });
          }}>
            {motionMethod === "anchored" ? motionStartMode === "upload" ? t("Feltöltött képből videó készítése") : t("Jelenetkép készítése ellenőrzésre") : t("Szereplő cseréje a kiválasztott modellre")}
          </button>
          <Badge k="modelMotion" /><Price k="modelMotion" />
        </div>
        {motionMethod === "anchored" && motionStartMode === "generated" && <>
          <label htmlFor="scene-prompt">{t("Mit változtassunk a jelenetképen? (nem kötelező)")}</label>
          <textarea id="scene-prompt" maxLength={500} value={scenePrompt} onChange={(e) => setScenePrompt(e.target.value)}
            placeholder={t("Például: kissé dúsabb alak, természetes arányokkal; a helyszín és a kellékek maradjanak.")} />
          <p className="muted">{t("A jelenetkép külön, kisebb költségű lépés. Ha nem tetszik, írd át a kérést és készíts újat. A videó csak a jóváhagyó gombbal indul.")}</p>
          <p className="muted">{t("Az arcvonásokat is ellenőrizd a jelenetképen. A magas minőségű videó a részleteket jobban őrző mozgásmodellt használja; a végső arcot és mimikát a kész videóban is nézd meg.")}</p>
          <Results k="scenePreview" kind="image" />
          {msg.scenePreview && <p className="muted" role="status">{msg.scenePreview}</p>}
          {sceneChoice && sceneChoice.videoId === v2vVideo && sceneChoice.characterId === toolChar &&
            results.scenePreview?.some((item) => item.assetId === sceneChoice.assetId) && (
            <button disabled={busyKey !== null || jobs.scenePreview?.status !== "completed" && jobs.scenePreview?.id === sceneChoice.jobId}
              onClick={() => {
                setResults((current) => ({ ...current, modelMotion: [] }));
                run("modelMotion", "character_motion_video", { videoAssetId: v2vVideo, quality: motionQuality,
                  motionMethod: "anchored", voiceMode: motionVoiceMode,
                  scenePreviewJobId: sceneChoice.jobId, sceneImageAssetId: sceneChoice.assetId }, { characterId: toolChar });
              }}>{t("A jelenetkép jó, videó készítése")}</button>
          )}
        </>}
        <Results k="modelMotion" kind="video" />
        {results.modelMotion?.some((item) => item.mediaType === "video" && item.assetId) && (
          <button className="ghost" type="button" style={{ marginTop: 8 }} onClick={() => {
            const latest = results.modelMotion.find((item) => item.mediaType === "video" && item.assetId);
            if (latest) {
              setTalkVideo(latest.assetId);
              setMsg((current) => ({ ...current, talk: t("A kész modellvideó kiválasztva. Töltsd fel az ElevenLabsban készített hangot, majd indítsd a Lip Sync műveletet.") }));
            }
          }}>{t("Kész modellvideó használata a hanghoz")}</button>
        )}
        {msg.modelMotion && <p className="muted">{msg.modelMotion}</p>}
        <div style={{ borderTop: "1px solid var(--border)", marginTop: 20, paddingTop: 16 }}>
          <h4>{t("Új mozgás egy sikerült modellvideóból")}</h4>
          <p className="muted">{t("Válassz egy korábbi, kész videót ugyanettől a modelltől. Egyetlen új, 8 másodperces, 1080p videó készül eltérő, természetes mozgással. A jelenet és az arc kiindulópontja a videó egyik jól látható képkockája. Az eredmény a galériába kerül; a mozdulatokat és az arcot közzététel előtt nézd meg. Ez külön fizetős generálás.")}</p>
          <Picker media="video" selected={variationVideo} onSelect={setVariationVideo} approvedOnly />
          <select aria-label={t("Új mozgás stílusa")} value={variationStyle}
            onChange={(e) => setVariationStyle(e.target.value as "playful" | "confident" | "casual")}
            style={{ marginTop: 8 }}>
            <option value="playful">{t("Játékos")}</option>
            <option value="confident">{t("Magabiztos")}</option>
            <option value="casual">{t("Laza, természetes")}</option>
          </select>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
            <button disabled={busyKey !== null || !toolChar || !approvedVideos.some((g) => g.assetId === variationVideo && g.characterId === toolChar)}
              onClick={() => {
                setResults((current) => ({ ...current, newMotion: [] }));
                run("newMotion", "character_motion_video", {
                  videoAssetId: variationVideo, quality: "pro", motionMethod: "creative",
                  motionStyle: variationStyle, voiceMode: "original",
                }, { characterId: toolChar });
              }}>{t("Egy új, jó minőségű videó készítése")}</button>
            <Badge k="newMotion" /><Price k="newMotion" />
          </div>
          <Results k="newMotion" kind="video" />
          {msg.newMotion && <p className="muted">{msg.newMotion}</p>}
        </div>
        <div style={{ borderTop: "1px solid var(--border)", marginTop: 20, paddingTop: 16 }}>
          <h4>{t("Új szöveg ugyanazon a helyszínen")}</h4>
          <p className="muted">{t("Válassz egy jól sikerült, természetesen mozgó modellvideót a galériából. A saját hangján felmondott új szöveghez a szájmozgást igazítjuk; a helyszínt és a gesztusok időzítését az alapvideó adja. Olyan felvételt válassz, amelynek mozdulatai illenek a mondandóhoz. A videó a hang és a forrás közül a rövidebb hosszáig tart, legfeljebb 30 másodpercig. Egy indítás egy eredményt készít.")}</p>
          <Picker media="video" selected={sceneVideo} onSelect={setSceneVideo} approvedOnly />
          <label htmlFor="scene-text">{t("Mit mondjon a modell?")}</label>
          <textarea id="scene-text" rows={5} maxLength={450} value={sceneText}
            onChange={(e) => setSceneText(e.target.value)} placeholder={t("Írd be a magyar szöveget...")} />
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
            <button disabled={busyKey !== null || !toolChar || !approvedVideos.some((g) => g.assetId === sceneVideo && g.characterId === toolChar) || sceneText.trim().length < 20}
              onClick={() => {
                setResults((current) => ({ ...current, talkingScene: [] }));
                run("talkingScene", "character_motion_video", {
                  videoAssetId: sceneVideo, quality: "pro", motionMethod: "talking_scene",
                  speechText: sceneText.trim(), voiceMode: "model",
                }, { characterId: toolChar });
              }}>{t("Egy beszélő jelenet készítése")}</button>
            <Badge k="talkingScene" /><Price k="talkingScene" />
          </div>
          <Results k="talkingScene" kind="video" />
          {msg.talkingScene && <p className="muted">{msg.talkingScene}</p>}
        </div>
        <details style={{ marginTop: 14 }}>
          <summary>{t("Csak arc és haj cseréje az eredeti videóban")}</summary>
          <p className="muted">{t("Az eredeti test és háttér megtartásához válaszd ezt. A fenti szereplőcsere a teljes látható személyt célozza.")}</p>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
          <select aria-label={t("Videó felbontás")} value={videoResolution} onChange={(e) => setVideoResolution(e.target.value as "480p" | "720p")}>
            <option value="720p">{t("720p")}</option><option value="480p">{t("480p")}</option>
          </select>
          <button disabled={busyKey !== null || !toolChar || !v2vVideo} onClick={() => run("videoSwap", "video_character_swap", { videoAssetId: v2vVideo, resolution: videoResolution }, { characterId: toolChar })}>{t("Csak arc és haj áthelyezése")}</button>
          <Badge k="videoSwap" /><Price k="videoSwap" />
        </div>
        <Results k="videoSwap" kind="video" />
        {msg.videoSwap && <p className="muted">{msg.videoSwap}</p>}
        </details>
        <details style={{ marginTop: 14 }}>
          <summary>{t("Egyéb videós eszközök")}</summary>
        <label>{t("Forrás (videó az i2v-hez: kép fent)")}</label>
        <Picker media="video" selected={v2vVideo} onSelect={setV2vVideo} />
        <input placeholder={t("videó asset ID")} value={v2vVideo} onChange={(e) => setV2vVideo(e.target.value)} style={{ marginTop: 6 }} />
        <input placeholder={t("stílus/mozgás prompt")} value={v2vPrompt} onChange={(e) => setV2vPrompt(e.target.value)} style={{ marginTop: 6 }} />
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
          <button disabled={busyKey === "v2v" || !v2vVideo || !v2vPrompt.trim()}
            onClick={() => run("v2v", "video_to_video", { videoAssetId: v2vVideo, prompt: v2vPrompt, duration: vDuration, aspectRatio: vRatio })}>{t("Videó→videó")}</button>
          <button className="ghost" disabled={busyKey === "motion" || !v2vVideo || !v2vPrompt.trim()}
            onClick={() => run("motion", "motion_control", { videoAssetId: v2vVideo, prompt: v2vPrompt, duration: vDuration, aspectRatio: vRatio }, { characterId: toolChar || undefined })}>{t("Kameramozgás (régi)")}</button>
          <Badge k="v2v" /><Price k="v2v" />
        </div>
        <Results k="v2v" kind="video" />
        {msg.v2v && <p className="muted">{msg.v2v}</p>}
        </details>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3 id="image-editor" style={{ marginTop: 0 }}>{t("Image Editor · Pinterest Composition · Image-to-Video · TTS")}</h3>
        <Picker media="image" selected={edAsset} onSelect={setEdAsset} />
        <button className="ghost" disabled={busyKey !== null} onClick={async () => { const id = await upload("image/jpeg,image/png,image/webp", undefined, 10 * 1024 * 1024); if (id) setEdAsset(id); }}>{t("Kép feltöltése")}</button>
        <input placeholder={t("asset ID")} value={edAsset} onChange={(e) => setEdAsset(e.target.value)} style={{ marginTop: 6 }} />
        <input placeholder={t("szerkesztési prompt")} value={edPrompt} onChange={(e) => setEdPrompt(e.target.value)} style={{ marginTop: 6 }} />
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
          <button disabled={busyKey === "edit" || !edAsset || !edPrompt.trim()} onClick={() => run("edit", "image_edit", { imageAssetIds: [edAsset], prompt: edPrompt })}>{t("Szerkesztés")}</button>
          <button className="ghost" disabled={busyKey === "pinterest" || !edAsset || !edPrompt.trim()}
            onClick={() => run("pinterest", "pinterest_composition", { sourceAssetId: edAsset, prompt: edPrompt }, { characterId: toolChar || undefined })}>{t("Pinterest-kompozíció")}</button>
          <Badge k="edit" /><Price k="edit" />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
          <input placeholder={t("i2v prompt")} value={vPrompt} onChange={(e) => setVPrompt(e.target.value)} style={{ flex: 1 }} />
          <select value={vDuration} onChange={(e) => setVDuration(e.target.value)}><option value="5">{t("5 mp")}</option><option value="10">{t("10 mp")}</option></select>
          <select value={vRatio} onChange={(e) => setVRatio(e.target.value)}><option>16:9</option><option>9:16</option><option>1:1</option></select>
          <button disabled={busyKey === "i2v" || !edAsset || !vPrompt.trim() || !vModel}
            onClick={() => run("i2v", "video_from_image", { sourceAssetId: edAsset, prompt: vPrompt, duration: vDuration, aspectRatio: vRatio, model: vModel }, { characterId: toolChar || undefined })}>{t("I2V")}</button>
          <Badge k="i2v" /><Price k="i2v" />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
          <input placeholder={t("TTS szöveg")} value={ttsText} onChange={(e) => setTtsText(e.target.value)} style={{ flex: 1 }} />
          <select value={ttsVoice} onChange={(e) => setTtsVoice(e.target.value)}><option>{t("Jennifer (en)")}</option><option>{t("Dexter (en)")}</option><option>{t("Arista (hu)")}</option></select>
          <button disabled={busyKey === "tts" || !ttsText.trim()} onClick={() => run("tts", "tts", { text: ttsText, voice: ttsVoice, speed: 1 })}>{t("TTS")}</button>
          <Badge k="tts" /><Price k="tts" />
        </div>
        <Results k="edit" kind="image" /><Results k="i2v" kind="video" /><Results k="tts" kind="video" />
        {(msg.edit || msg.i2v || msg.tts) && <p className="muted">{[msg.edit, msg.i2v, msg.tts].filter(Boolean).join(" · ")}</p>}
      </div>
      <p className="muted" style={{ marginTop: 10 }}>{t("Viral Reels, Trends, Niche, Carousel és TikTok-import a Tartalom menüben érhető el.")}</p>
    </main>
  );
}
