import { describe, expect, it } from "vitest";
import { createHash } from "crypto";
import { inspectReferenceFile } from "@/lib/referenceQuality";

describe("referenciafájl technikai ellenőrzése", () => {
  const bytes = Buffer.alloc(1200, 7);
  bytes.set([0x89, 0x50, 0x4e, 0x47], 0);
  const asset = {
    content_type: "image/png", bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  it("az ép képet elfogadja, az ismételt képet elutasítja", () => {
    const seen = new Set<string>();
    expect(inspectReferenceFile(bytes, asset, seen).ok).toBe(true);
    expect(inspectReferenceFile(bytes, asset, seen)).toMatchObject({ error: "DUPLICATE_IMAGE" });
  });
  it("a tartalom és a tárolt hash eltérését elutasítja", () => {
    expect(inspectReferenceFile(bytes, { ...asset, sha256: "wrong" }, new Set())).toMatchObject({ error: "IMAGE_INTEGRITY_FAILED" });
    expect(inspectReferenceFile(bytes, { ...asset, content_type: "image/jpeg" }, new Set())).toMatchObject({ ok: true, contentType: "image/png" });
    expect(inspectReferenceFile(Buffer.alloc(1200), asset, new Set())).toMatchObject({ error: "INVALID_IMAGE_FORMAT" });
  });
});
