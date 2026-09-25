import { describe, it, expect } from "vitest";
import { sniffImage, TRAINING_LIMITS, buildZip } from "@/lib/trainingDataset";

describe("training-prep tartalom-azonosítás (unit)", () => {
  it("JPEG/PNG/WEBP magic byte felismerés", () => {
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]))).toBe("image/jpeg");
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe("image/png");
    expect(sniffImage(Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
  });
  it("hamis WebP/RIFF és ismeretlen tartalom elutasítva", () => {
    expect(sniffImage(Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]))).toBeNull(); // RIFF, de AVI
    expect(sniffImage(Buffer.from("not an image"))).toBeNull();
    expect(sniffImage(Buffer.from([]))).toBeNull();
  });
  it("korlátok értelmesek", () => {
    expect(TRAINING_LIMITS.minFiles).toBe(3);
    expect(TRAINING_LIMITS.maxTotalBytes).toBeGreaterThan(TRAINING_LIMITS.maxZipBytes);
    expect(buildZip([{ name: "a.jpg", data: Buffer.from([1, 2]) }])).toBeInstanceOf(Buffer);
  });
});
