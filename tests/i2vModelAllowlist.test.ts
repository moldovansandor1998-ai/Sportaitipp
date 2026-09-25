import { describe, it, expect, afterEach } from "vitest";
import { allowedI2vModels, isAllowedI2vModel } from "@/lib/providers/modelAllowlist";

describe("I2V modell-engedélyezett lista", () => {
  const saved = process.env.NODE_ENV;
  afterEach(() => {
    Object.assign(process.env, { NODE_ENV: saved });
    delete process.env.FAL_KEY; delete process.env.REPLICATE_API_TOKEN;
    Object.assign(process.env, { NODE_ENV: "test" });
  });
  it("fal kulccsal a Kling az engedélyezett; idegen modell elutasítva", () => {
    process.env.FAL_KEY = "k";
    const list = allowedI2vModels();
    expect(list.map((m) => m.id)).toContain("kling-v2.1-i2v");
    expect(isAllowedI2vModel("kling-v2.1-i2v")).toBe(true);
    expect(isAllowedI2vModel("random-hacked-model")).toBe(false);
    expect(isAllowedI2vModel(undefined)).toBe(false);
  });
  it("kulcsok nélkül productionben üres lista – semmi modell nem engedélyezett", () => {
    delete process.env.FAL_KEY; delete process.env.REPLICATE_API_TOKEN;
    Object.assign(process.env, { NODE_ENV: "production" });
    expect(allowedI2vModels()).toHaveLength(0);
    expect(isAllowedI2vModel("kling-v2.1-i2v")).toBe(false);
  });
});
