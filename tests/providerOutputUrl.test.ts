import { describe, expect, it } from "vitest";
import { assertAllowedProviderOutputUrl, assertAllowedUrl } from "@/lib/security/ssrf";

const host = "57e7777c531440a7095f6b86d24d79f6.r2.cloudflarestorage.com";
describe("Nureta output download", () => {
  it("accepts the actual signed R2 output only in the Nureta provider context", () => {
    const url = `https://${host}/video.mp4?X-Amz-Signature=test`;
    expect(assertAllowedProviderOutputUrl(url, "nureta").hostname).toBe(host);
    expect(() => assertAllowedUrl(url)).toThrow("URL_HOST_NOT_ALLOWED");
    expect(() => assertAllowedProviderOutputUrl(url, "wavespeed")).toThrow("URL_HOST_NOT_ALLOWED");
    expect(() => assertAllowedProviderOutputUrl(url)).toThrow("URL_HOST_NOT_ALLOWED");
  });
  it("rejects HTTP, credentials, nonstandard ports, lookalikes and other R2 accounts", () => {
    for (const url of [`http://${host}/x`, `https://user:pass@${host}/x`, `https://${host}:8443/x`,
      `https://${host}.evil.example/x`, "https://other.r2.cloudflarestorage.com/x", "https://127.0.0.1/x"]) {
      expect(() => assertAllowedProviderOutputUrl(url, "nureta")).toThrow();
    }
  });
});
