// Tartalom-generátor motor – DETERMINISZTIKUS, szabályalapú (kulcs nélkül is valódi kimenet).
export interface ReelsCopyInput { topic: string; audience: string; tone: string; cta: string; }
export interface ReelsCopy { hook: string; script: string[]; caption: string; hashtags: string[]; }

const TONES: Record<string, string> = {
  energetic: "Energetic, fast-paced, bold",
  calm: "Calm, friendly, trustworthy",
  expert: "Expert, no-nonsense, insightful",
  funny: "Funny, light, self-ironic",
};

export function generateReelsCopy(input: ReelsCopyInput): ReelsCopy {
  const tone = TONES[input.tone] ?? TONES.energetic;
  const t = input.topic.trim();
  const a = input.audience.trim() || "your audience";
  const cta = input.cta.trim() || "Follow for more";
  return {
    hook: `Stop scrolling – this is for ${a}.`,
    script: [
      `${tone} open: "${t}" in one sentence.`,
      `Problem: most people get ${t} wrong.`,
      `Turn: here is the 15-second fix.`,
      `Proof: quick demo / before-after.`,
      `Close: ${cta}.`,
    ],
    caption: `${t} – the 15-second version. ${cta}.`,
    hashtags: [t.toLowerCase().replace(/[^a-z0-9]+/g, ""), "reels", "tips", "ai", "content"].filter(Boolean),
  };
}

export interface TrendItem { title: string; platform: string; score: number; why: string; }
export function generateTrends(niche: string): TrendItem[] {
  const n = niche.trim().toLowerCase();
  return [
    { title: `POV: ${n} rutin 15 mp alatt`, platform: "tiktok", score: 87, why: "POV-formátum + gyors ígéret" },
    { title: `3 hiba, amit mindenki elkövet ${n}-ben`, platform: "instagram", score: 82, why: "lista + negatív keret" },
    { title: `Before/After – ${n} átalakulás`, platform: "tiktok", score: 79, why: "vizuális bizonyíték" },
    { title: `„Nem hiszed el, mit találtam” – ${n} reveal`, platform: "instagram", score: 74, why: "kíváncsisági rés" },
    { title: `${n} FAQ – a 3 leggyakoribb kérdés`, platform: "tiktok", score: 71, why: "keresési szándék" },
  ];
}

export interface NicheIdea { niche: string; angle: string; monetization: string; difficulty: string; }
export function generateNiches(interests: string[]): NicheIdea[] {
  const base = interests.length ? interests : ["fitness", "cooking", "tech", "travel", "fashion"];
  const angles = ["behind-the-scenes", "tutorial", "myth-busting", "day-in-the-life", "top-5 lists"];
  const mons = ["brand deals", "digital products", "affiliate", "membership"];
  return base.slice(0, 5).map((b, i) => ({
    niche: `${b} ${angles[i % angles.length]}`,
    angle: angles[i % angles.length],
    monetization: mons[i % mons.length],
    difficulty: ["easy", "medium", "hard"][i % 3],
  }));
}

export function renderCarouselPage(title: string, bullets: string[], idx: number, total: number): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const rows = bullets.slice(0, 4).map((b, i) =>
    `<text x="60" y="${340 + i * 90}" font-family="Arial" font-size="34" fill="#dfe4ee">• ${esc(b)}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
<rect width="1080" height="1350" fill="#12151d"/>
<text x="60" y="120" font-family="Arial" font-size="30" fill="#7cc4ff">${esc(title)}</text>
<text x="60" y="220" font-family="Arial" font-size="52" font-weight="bold" fill="#ffffff">${idx + 1}/${total}</text>
${rows}
<text x="60" y="1280" font-family="Arial" font-size="26" fill="#8b93a7">Castora Carousel</text>
</svg>`;
}
