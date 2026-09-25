import { describe, it, expect } from "vitest";
import { buildZip, crc32, zipToDataUrl } from "@/lib/trainingDataset";

describe("trainingDataset ZIP (store-method)", () => {
  it("CRC32 ismert vektor: '123456789' → 0xCBF43926", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
  it("ZIP felépíthető és kicsomagolható (unzip -t kompatibilis struktúra)", async () => {
    const { execSync } = await import("child_process");
    const { writeFileSync, mkdtempSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const zip = buildZip([
      { name: "ref_01.jpg", data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]) },
      { name: "ref_02.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9]) },
    ]);
    // aláírások + central directory jelen vannak
    expect(zip.subarray(0, 4).readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.includes(Buffer.from("ref_02.png"))).toBe(true);
    const dir = mkdtempSync(join(tmpdir(), "zip-"));
    writeFileSync(join(dir, "t.zip"), zip);
    const out = execSync(`cd ${dir} && unzip -t t.zip`).toString();
    expect(out).toContain("No errors");
    expect(out).toContain("ref_01.jpg");
  });
  it("data URL formátum helyes", () => {
    expect(zipToDataUrl(buildZip([{ name: "a.jpg", data: Buffer.from([1]) }]))).toMatch(/^data:application\/zip;base64,/);
  });
});
