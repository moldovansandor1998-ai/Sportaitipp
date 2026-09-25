import { describe, it, expect } from "vitest";
import { assertAllowedUrl } from "@/lib/security/ssrf";

describe("SSRF-védelem", () => {
  it("privát és link-local címek tiltva", () => {
    for (const u of ["http://127.0.0.1/x", "http://localhost/x", "http://192.168.1.1/x", "http://10.0.0.5/x", "http://169.254.169.254/x"]) {
      expect(() => assertAllowedUrl(u)).toThrow();
    }
  });
  it("file: és felhasználói jelszavas URL tiltva", () => {
    expect(() => assertAllowedUrl("file:///etc/passwd")).toThrow();
    expect(() => assertAllowedUrl("http://user:pass@example.com/x")).toThrow();
  });
});
