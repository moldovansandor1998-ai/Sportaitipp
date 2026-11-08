import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const names = ["image-generation", "video-motion", "voice-talking-video", "content-planning", "creative-library"];
describe("public feature photography", () => {
  it.each(names)("ships a wide original PNG for %s", (name) => {
    const bytes = readFileSync(path.join(process.cwd(), "public/images/feature-photos", `${name}.png`));
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(bytes.readUInt32BE(16)).toBe(1672);
    expect(bytes.readUInt32BE(20)).toBe(941);
  });
  it("uses responsive optimized decorative photos and preserves the character illustration", () => {
    const source = readFileSync("src/components/marketing/Artwork.tsx", "utf8");
    for (const name of names) expect(source).toContain(`"${name}"`);
    expect(source).toContain('import Image from "next/image"');
    expect(source).toContain('alt="" fill quality={88}');
    expect(source).toContain('<Portrait id={id} />');
    expect(source).not.toContain('unoptimized');
    expect(source).not.toContain('priority');
  });
  it("keeps equal wide card frames without changing hero artwork", () => {
    const css = readFileSync("src/components/marketing/LandingPage.module.css", "utf8");
    expect(css).toContain('.featureCard > .toolArt { height: auto; aspect-ratio: 17 / 10; }');
    expect(css).toContain('object-fit: cover');
  });
});
