import { describe, expect, it } from "vitest";
import { isInternalOwner, isInternalPath } from "@/lib/security/internalAccess";
describe("internal customer access boundaries", () => {
  it("protects operational pages and all nested internal APIs", () => {
    for (const path of ["/admin", "/model-studio", "/x-comments", "/api/model-studio/sources/sign", "/api/model-studio/items/1/slides/0/regenerate", "/api/x/accounts", "/api/trends/import"]) expect(isInternalPath(path)).toBe(true);
  });
  it("preserves public generation, credits and existing gallery data", () => {
    for (const path of ["/gallery", "/tools", "/api/gallery", "/api/jobs", "/api/elevenlabs/speech", "/api/billing/checkout", "/api/jobs/process", "/model-studio-public"]) expect(isInternalPath(path)).toBe(false);
  });
});

it("allows only the exact authenticated owner email, not arbitrary admins or similar addresses", () => {
  expect(isInternalOwner("moldovansandor1998@gmail.com")).toBe(true);
  for (const email of [null, undefined, "", "admin@example.com", "moldovansandor1998@gmail.com.evil.example", "customer@example.com"]) expect(isInternalOwner(email)).toBe(false);
});
