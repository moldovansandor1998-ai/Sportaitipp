import Image from "next/image";
import type { ToolArt } from "./content";
import styles from "./LandingPage.module.css";

export function Icon({ name, className }: { name: "arrow" | "spark" | "search" | "grid" | "check" | "globe"; className?: string }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
    {name === "arrow" && <path d="M5 12h14m-5-5 5 5-5 5" />}
    {name === "spark" && <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" /><path d="m20 2 .6 1.4L22 4l-1.4.6L20 6l-.6-1.4L18 4l1.4-.6L20 2Z" /></>}
    {name === "search" && <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>}
    {name === "grid" && <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>}
    {name === "check" && <path d="m5 12 4 4L19 6" />}
    {name === "globe" && <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>}
  </svg>;
}

// Original vector artwork. These illustrations are not customer results or app screenshots.
export function Portrait({ id }: { id: string }) {
  return <svg viewBox="0 0 300 340" fill="none" className={styles.portrait} aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-skin`} x1="95" y1="78" x2="212" y2="250" gradientUnits="userSpaceOnUse"><stop stopColor="#e4c5ff" /><stop offset=".5" stopColor="#ab8adc" /><stop offset="1" stopColor="#634889" /></linearGradient>
      <linearGradient id={`${id}-coat`} x1="46" y1="250" x2="246" y2="330" gradientUnits="userSpaceOnUse"><stop stopColor="#8259d2" /><stop offset=".5" stopColor="#342c51" /><stop offset="1" stopColor="#151724" /></linearGradient>
      <linearGradient id={`${id}-hair`} x1="100" y1="40" x2="218" y2="177" gradientUnits="userSpaceOnUse"><stop stopColor="#2b264c" /><stop offset=".5" stopColor="#101424" /><stop offset="1" stopColor="#7555a3" /></linearGradient>
    </defs>
    <circle cx="150" cy="157" r="119" stroke="#d4bcff" strokeOpacity=".18" /><circle cx="150" cy="157" r="102" stroke="#d4bcff" strokeOpacity=".1" />
    <path d="M115 212v31l-40 18-20 79h193l-20-79-44-18v-37" fill={`url(#${id}-skin)`} />
    <path d="M53 340c0-61 17-82 63-97l35 37 33-38c47 14 65 40 65 98H53Z" fill={`url(#${id}-coat)`} />
    <path d="m108 247 43 33-26 29-27-55m87-12-34 38 29 27 22-57" stroke="#c9a3ff" strokeOpacity=".48" strokeWidth="1.5" />
    <path d="M92 129c0-59 30-82 62-82 45 0 64 28 64 77l-11 69c-3 35-33 60-55 59-27-1-53-29-55-64l-5-59Z" fill={`url(#${id}-hair)`} />
    <path d="m101 134 4 49c3 31 26 56 48 56s48-28 51-58l3-52-17-35-50-13-39 53Z" fill={`url(#${id}-skin)`} />
    <path d="M94 149c-8-48 8-96 53-104 40-8 68 22 69 52-21-3-38-11-48-24-16 30-44 33-58 37l-16 39Z" fill={`url(#${id}-hair)`} />
    <path d="M113 151c7-5 16-5 23-1m36 0c7-4 16-4 22 1" stroke="#49315f" strokeWidth="3.5" strokeLinecap="round" />
    <path d="M116 159c6 4 12 4 17 0m42 0c5 4 10 4 15 0" stroke="#322c48" strokeWidth="2" strokeLinecap="round" />
    <path d="m155 159-4 25 7 3m-21 15c11 7 21 7 32-1" stroke="#7a527f" strokeWidth="2" strokeLinecap="round" />
    <path d="M103 169c-16-7-12 19 4 20m98-20c14-6 11 17-3 19" stroke="#b59bd4" strokeWidth="5" />
    <circle cx="103" cy="191" r="4" stroke="#aaf5db" strokeWidth="2" /><circle cx="203" cy="191" r="4" stroke="#aaf5db" strokeWidth="2" />
    <path d="m83 111-14 0v16m149-16h14v16M69 202v16h14m149-16v16h-14" stroke="#b2f6df" strokeWidth="1.5" strokeOpacity=".8" />
    <path d="M84 267c-14 20-17 44-17 73m149-71c16 23 18 43 18 71" stroke="#9d71e0" strokeOpacity=".4" />
  </svg>;
}

export function Landscape({ id }: { id: string }) {
  return <svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" fill="none" className={styles.landscape} aria-hidden="true">
    <defs><linearGradient id={`${id}-sky`} x2="0" y2="240" gradientUnits="userSpaceOnUse"><stop stopColor="#3d315e" /><stop offset=".65" stopColor="#de9fbd" /><stop offset="1" stopColor="#f1bc96" /></linearGradient><linearGradient id={`${id}-mountain`} x2="0" y2="240" gradientUnits="userSpaceOnUse"><stop stopColor="#b4a1cf" /><stop offset="1" stopColor="#332f59" /></linearGradient></defs>
    <path d="M0 0h400v240H0z" fill={`url(#${id}-sky)`} /><circle cx="292" cy="69" r="32" fill="#ffcfad" /><path d="m0 175 75-93 54 62 68-113 101 128 56-63 46 38v106H0Z" fill={`url(#${id}-mountain)`} /><path d="m197 31-35 102 35-22 40 16-40-96Z" fill="#d8c8df" fillOpacity=".8" /><path d="m75 82-16 64 18-17 24 13-26-60Z" fill="#dac6e0" fillOpacity=".5" /><path d="m0 197 70-33 83 48 81-55 85 26 81-28v85H0Z" fill="#332a50" /><path d="m0 227 94-21 89 34H0Zm236 13 89-43 75 24v19H236Z" fill="#1b2137" /><path d="M151 240c1-15 14-18 16-25s-7-11-3-16 13-12 17-17" stroke="#be98c5" strokeOpacity=".7" strokeWidth="2" />
  </svg>;
}

export function Waveform() {
  return <div className={styles.waveform} aria-hidden="true">{[13, 25, 18, 40, 56, 34, 23, 62, 81, 51, 30, 69, 92, 61, 42, 77, 56, 33, 49, 66, 35, 21, 40, 16].map((height, i) => <i key={i} style={{ height: `${height}%` }} />)}</div>;
}

const featurePhotos: Partial<Record<ToolArt, string>> = {
  image: "image-generation",
  video: "video-motion",
  audio: "voice-talking-video",
  content: "content-planning",
  gallery: "creative-library",
};

export function ToolArtwork({ art, id }: { art: ToolArt; id: string }) {
  const photo = featurePhotos[art];
  return <div className={`${styles.toolArt} ${styles[`art_${art}`]}`} aria-hidden="true">
    {photo ? <Image src={`/images/feature-photos/${photo}.png`} alt="" fill quality={88}
      sizes="(max-width: 540px) calc(100vw - 40px), (max-width: 820px) calc((100vw - 64px) / 2), 420px"
      className={styles.featurePhoto} /> : <><div className={styles.artGrid} /><Portrait id={id} /><span className={styles.artCorner}>CHARACTER / 01</span></>}
  </div>;
}
