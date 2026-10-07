/** Shared mandatory continuity for approved-image scene videos only. */
export const VIDEO_CONTINUITY_RULES = "Mandatory continuity rules, overriding any conflicting motion instruction: Keep a fixed camera and the starting image's framing throughout. No zoom in or out, digital zoom, reframing, camera push-in or pull-back, cuts or scene transitions. The exact same person from the starting image must remain in every frame from start to finish. Preserve their face, facial features, eye color, hair color and length, body proportions and clothing. No identity drift, morphing, face replacement or switching to another or similar-looking person. Keep the original background and lighting consistent. Animate only the requested natural movements.";
const prefix = VIDEO_CONTINUITY_RULES + "\nRequested motion: ";
export const ANALYZED_MOTION_MAX_LENGTH = 1500 - prefix.length;

export function withVideoContinuity(prompt: string): string {
  return prompt.startsWith(prefix) ? prompt : prefix + prompt;
}
