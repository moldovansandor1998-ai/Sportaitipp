// Per-character correction; retain the established prompts for all other models.
const SA_CHARACTER_ID = "0b3d1a82-288d-43f0-b91f-b0cf0c2261e8";
export function characterIdentityVariant(characterId?: string): "male" | undefined {
  return characterId === SA_CHARACTER_ID ? "male" : undefined;
}
export function applyCharacterIdentity(prompt: string, variant: unknown): string {
  if (variant !== "male") return prompt;
  return prompt.replaceAll("adult woman", "adult man")
    .replaceAll("same woman's", "same man's")
    .replaceAll("the woman", "the man")
    .replaceAll(" her ", " his ")
    + " Preserve the adult man's male facial features, beard, short haircut, hairline and body build exactly from the identity reference. The source scene supplies only composition, pose, clothing and objects; the identity references determine the person.";
}
