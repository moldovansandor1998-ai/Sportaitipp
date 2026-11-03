import { withVideoContinuity } from "@/lib/videoContinuity";
import type { RedubDelivery } from "@/lib/videoRedub";

export const TALKING_MOTIONS = ["subtle", "natural", "expressive"] as const;
export type TalkingMotion = typeof TALKING_MOTIONS[number];
export const TALKING_COMMENT_SCRIPT = `Na, erre tényleg kíváncsi vagyok: szerintetek mennyit kell ma havonta, nettóban keresni Magyarországon ahhoz, hogy az ember jól éljen, és még félre is tudjon tenni?

Nem luxusra gondolok, hanem lakhatásra, kajára, néha egy étteremre vagy nyaralásra. Egyedül vagy párban szerintetek mennyi az elég? Írjátok meg kommentben azt is, melyik városról beszéltek!

Ja, és ha társkeresőt kerestek, próbáljátok ki a VagyokRádot, és regisztrációnál használjátok a DORIKA kódot!

Ha pedig nekem szeretnél írni és ismerkedni, a biómban megtalálod a Telegramomat. Ott keress privátban!`;

/** Delivery comes from the approved audio job, not an unrelated client mood override. */
export function imageTalkingPrompt(delivery: RedubDelivery, motion: TalkingMotion): string {
  const mood: Record<RedubDelivery, string> = {
    natural: "Relaxed, warm, conversational delivery.",
    girly: "Cheerful friendly storytelling, gentle smiles.",
    energetic: "Lively enthusiastic delivery without exaggerated expressions.",
    story: "Engaging intimate storytelling with attentive eye contact and varied expressions.",
    curious: "Genuinely curious conversation, occasional slight eyebrow raises and a small questioning head tilt.",
    serious: "Thoughtful calm serious expression and restrained gestures.",
    confident: "Confident relaxed expression, steady eye contact and small affirming nods.",
  };
  const gestures: Record<TalkingMotion, string> = {
    subtle: "Minimal motion: natural blinks, subtle breathing and tiny irregular head movements.",
    natural: "Natural blinks and breathing, small varied head and shoulder gestures timed to the speech.",
    expressive: "Varied small conversational head and shoulder gestures; small open-hand gestures only if the hands are already visible in the image.",
  };
  return withVideoContinuity(`Photorealistic single-person talking video, lips synchronized to the supplied complete speech audio. ${mood[delivery] ?? mood.natural} ${gestures[motion]} Keep expressions believable, never mechanical or repetitive. No rhythmic swaying, excessive gestures, new objects or subtitles.`);
}
