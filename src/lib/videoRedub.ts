export const REDUB_MAX_TEXT = 3000;
export const REDUB_MAX_SECONDS = 180;
export const REDUB_DELIVERIES = ["natural", "girly", "energetic"] as const;
export type RedubDelivery = typeof REDUB_DELIVERIES[number];

export function redubSpeechText(text: string, delivery: RedubDelivery): string {
  const clean = text.trim().replace(/\*\*/g, "");
  return delivery === "girly" ? `[cheerfully] ${clean}`
    : delivery === "energetic" ? `[excited] ${clean}` : clean;
}
