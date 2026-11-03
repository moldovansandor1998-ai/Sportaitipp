export const REDUB_MAX_TEXT = 3000;
export const REDUB_MAX_SECONDS = 180;
export const REDUB_DELIVERIES = ["natural", "girly", "energetic", "story", "curious", "serious", "confident"] as const;
export type RedubDelivery = typeof REDUB_DELIVERIES[number];

export function redubSpeechText(text: string, delivery: RedubDelivery): string {
  const clean = text.trim().replace(/\*\*/g, "");
  const tags: Record<RedubDelivery, string> = {
    natural: "", girly: "[cheerfully] ", energetic: "[excited] ", story: "[storytelling] ",
    curious: "[curious] ", serious: "[serious] ", confident: "[confident] ",
  };
  return (tags[delivery] ?? "") + clean;
}
