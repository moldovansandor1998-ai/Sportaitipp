// Stored gender controls identity; retain established female prompts byte for byte.
export type CharacterGender = "female" | "male";
const SA_CHARACTER_ID = "0b3d1a82-288d-43f0-b91f-b0cf0c2261e8";
const ZSOFIA_CHARACTER_ID = "14d3cc62-004b-43f5-a355-4939e4741e5f";
export function characterIdentityVariant(characterId?: string, gender?: unknown): "male" | "zsofia-brown-eyes" | undefined {
  if (characterId === ZSOFIA_CHARACTER_ID) return "zsofia-brown-eyes";
  if (gender === "female") return undefined;
  return gender === "male" || characterId === SA_CHARACTER_ID ? "male" : undefined;
}
export function applyCharacterIdentity(prompt: string, variant: unknown): string {
  if (variant === "zsofia-brown-eyes") return prompt + " The character has natural brown irises in both eyes. Keep both eyes brown and consistent with each other in every image and frame, including close-ups and changes in lighting. Do not copy the source person's eye color. Do not make her eyes blue, green, gray, hazel or different colors.";
  if (variant !== "male") return prompt;
  return prompt.replaceAll("adult woman", "adult man")
    .replaceAll("same woman's", "same man's")
    .replaceAll("the woman", "the man")
    .replaceAll(" her ", " his ")
    + " Preserve the adult man's male facial features, facial hair (or lack of it), hairstyle, hair length, hairline and body build exactly from the identity reference. The source scene supplies only composition, pose, clothing and objects; the identity references determine the person.";
}
