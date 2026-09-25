// Karakter-állapotgép (0005-ös migrációval szinkronban) + folyamat-kapuk.
export const CHARACTER_TRANSITIONS: Record<string, string[]> = {
  draft: ["collecting_refs", "archived"],
  collecting_refs: ["refs_qc", "archived"],
  refs_qc: ["ready_to_train", "collecting_refs", "archived"],
  ready_to_train: ["training", "archived"],
  training: ["test_pending", "failed", "archived"],
  test_pending: ["active", "training", "archived"],
  active: ["training", "archived"],
  rejected: ["collecting_refs", "archived"],
  failed: ["collecting_refs", "archived"],
};

export function canTransitionCharacter(from: string, to: string): boolean {
  if (from === to) return true;
  return (CHARACTER_TRANSITIONS[from] ?? []).includes(to);
}

/** identity_check csak tréning + tesztkép megléte után aktiválhat. */
export function canActivateCharacter(
  latestVersion: { status: string; test_image_asset_id: string | null } | null,
): boolean {
  if (!latestVersion) return false;
  if (latestVersion.status !== "test_pending") return false;
  return latestVersion.test_image_asset_id !== null;
}

/** reference_qc: minden refId a karakteré kell legyen (idegen refId támadás kizárva). */
export function assertRefOwnership(ownedRows: { id: string }[], requestedIds: string[]): void {
  const owned = new Set(ownedRows.map((r) => r.id));
  for (const id of requestedIds) {
    if (!owned.has(id)) throw new Error("REF_NOT_OWNED");
  }
}
