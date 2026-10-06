// Stored gender controls identity; retain established female prompts byte for byte.
export type CharacterGender = "female" | "male";
const SA_CHARACTER_ID = "0b3d1a82-288d-43f0-b91f-b0cf0c2261e8";
const ZSOFIA_CHARACTER_ID = "14d3cc62-004b-43f5-a355-4939e4741e5f";
export function characterIdentityVariant(characterId?: string, gender?: unknown): "male" | "zsofia-blue-eyes" | undefined {
  if (characterId === ZSOFIA_CHARACTER_ID) return "zsofia-blue-eyes";
  if (gender === "female") return undefined;
  return gender === "male" || characterId === SA_CHARACTER_ID ? "male" : undefined;
}
export function applyCharacterIdentity(prompt: string, variant: unknown): string {
  if (variant === "zsofia-blue-eyes") return prompt + " Match the identity references' natural muted gray-blue irises in both eyes, with realistic iris texture, normal dark pupils and subtle reflections appropriate to the scene lighting. Preserve their low saturation; do not intensify or brighten the blue, use vivid cyan, neon or glowing eyes, or create a colored-contact-lens appearance. The eye shade may appear darker in dim light. Preserve the identity references' short shoulder-length ash-blonde hair with darker roots: the ends sit at the shoulders, never extend down the chest. Use the identity references for hair length and color, not the source scene person's hair. Keep pose, clothing and scene composition from the source.";
  if (variant !== "male") return prompt;
  return prompt.replaceAll("adult woman", "adult man")
    .replaceAll("same woman's", "same man's")
    .replaceAll("the woman", "the man")
    .replaceAll(" her ", " his ")
    + " Preserve the adult man's male facial features, facial hair (or lack of it), hairstyle, hair length, hairline and body build exactly from the identity reference. The source scene supplies only composition, pose, clothing and objects; the identity references determine the person.";
}
