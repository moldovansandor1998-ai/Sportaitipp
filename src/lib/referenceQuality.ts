import { createHash } from "crypto";
import { sniffImage, TRAINING_LIMITS } from "@/lib/trainingDataset";

export function inspectReferenceFile(
  bytes: Buffer,
  asset: { content_type: string; bytes: number; sha256: string },
  seenHashes: Set<string>,
): { ok: true; hash: string; contentType: string } | { ok: false; error: string } {
  if (bytes.length < 1024 || bytes.length > TRAINING_LIMITS.maxFileBytes || bytes.length !== asset.bytes) {
    return { ok: false, error: "INVALID_IMAGE_SIZE" };
  }
  const contentType = sniffImage(bytes);
  if (!contentType) return { ok: false, error: "INVALID_IMAGE_FORMAT" };
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== asset.sha256) return { ok: false, error: "IMAGE_INTEGRITY_FAILED" };
  if (seenHashes.has(hash)) return { ok: false, error: "DUPLICATE_IMAGE" };
  seenHashes.add(hash);
  return { ok: true, hash, contentType };
}
