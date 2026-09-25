import { describe, it, expect } from "vitest";
import { buildEasyPrompt, normalizeEasyInput } from "@/lib/promptBuilder";

describe("Easy Mode prompt builder (determinisztikus)", () => {
  it("mezők sorrendben, üresek kihagyva", () => {
    const p = buildEasyPrompt({
      scene: "portré", outfit: "fehér ing", location: "stúdió",
      pose: "félprofil", cameraAngle: "85mm", lighting: "puha fény", visualStyle: "fotorealisztikus",
    });
    expect(p).toBe("fotorealisztikus, portré, fehér ing, félprofil, stúdió, 85mm, puha fény");
  });
  it("azonos bemenet → azonos prompt (determinisztikus)", () => {
    const a = buildEasyPrompt(normalizeEasyInput({ scene: "x", pose: "y" }));
    const b = buildEasyPrompt(normalizeEasyInput({ scene: "x", pose: "y" }));
    expect(a).toBe(b);
    expect(a).toBe("x, y");
  });
  it("minden mező üres → üres string", () => {
    expect(buildEasyPrompt(normalizeEasyInput({}))).toBe("");
  });
});
