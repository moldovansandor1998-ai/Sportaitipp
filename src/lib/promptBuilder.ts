// Easy Mode → determinisztikus prompt-összeállítás. Ugyanaz a függvény fut a kliensen
// (előnézet) és a szerveren (a végleges prompt MINDIG szerveroldalon készül).
export interface EasyInput {
  scene: string; outfit: string; location: string; pose: string;
  cameraAngle: string; lighting: string; visualStyle: string;
}

export const EASY_FIELDS: Array<{ key: keyof EasyInput; label: string; placeholder: string }> = [
  { key: "scene", label: "Jelenet", placeholder: "pl. portré, filmes jelenet" },
  { key: "outfit", label: "Ruha", placeholder: "pl. fehér ing, elegáns" },
  { key: "location", label: "Helyszín / háttér", placeholder: "pl. stúdió, semleges háttér" },
  { key: "pose", label: "Póz", placeholder: "pl. félprofil, kamerába néz" },
  { key: "cameraAngle", label: "Kamera szög", placeholder: "pl. szemmagasság, 85mm" },
  { key: "lighting", label: "Fények", placeholder: "pl. puha stúdiófény" },
  { key: "visualStyle", label: "Vizuális stílus", placeholder: "pl. fotorealisztikus, filmes" },
];

export function buildEasyPrompt(input: EasyInput): string {
  const parts = [
    input.visualStyle, input.scene, input.outfit,
    input.pose, input.location, input.cameraAngle, input.lighting,
  ].map((s) => (s ?? "").trim()).filter((s) => s.length > 0);
  return parts.join(", ");
}

export function normalizeEasyInput(raw: Record<string, unknown>): EasyInput {
  const pick = (k: keyof EasyInput): string => (typeof raw[k] === "string" ? (raw[k] as string).trim() : "");
  return {
    scene: pick("scene"), outfit: pick("outfit"), location: pick("location"),
    pose: pick("pose"), cameraAngle: pick("cameraAngle"), lighting: pick("lighting"),
    visualStyle: pick("visualStyle"),
  };
}
