// SSRF keményítés: pontos own-host, https-only, hiányzó konfig, támadó hasonmás-host.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { assertAllowedUrl, assertAllowedProviderOutputUrl } from "@/lib/security/ssrf";

const SAVED = process.env.NEXT_PUBLIC_SUPABASE_URL;
beforeAll(() => { process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefgh.supabase.co"; });
afterAll(() => { if (SAVED === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = SAVED; });

describe("SSRF keményítés (own Supabase Storage)", () => {
  it("pontos own-host https → engedélyezett", () => {
    expect(() => assertAllowedUrl("https://abcdefgh.supabase.co/storage/v1/object/sign/assets/x?token=t")).not.toThrow();
  });
  it("hasonló végződésű TÁMADÓ host elutasítva (suffix-trükk)", () => {
    expect(() => assertAllowedUrl("https://evil-abcdefgh.supabase.co/x")).toThrow(/URL_HOST_NOT_ALLOWED/);
    expect(() => assertAllowedUrl("https://abcdefgh.supabase.co.evil.example/x")).toThrow(/URL_HOST_NOT_ALLOWED/);
    expect(() => assertAllowedUrl("https://notabcdefgh.supabase.co/x")).toThrow(/URL_HOST_NOT_ALLOWED/);
  });
  it("http own-host elutasítva (https-only)", () => {
    expect(() => assertAllowedUrl("http://abcdefgh.supabase.co/x")).toThrow();
  });
  it("felhasználói tetszőleges host elutasítva", () => {
    expect(() => assertAllowedUrl("https://user-controlled.example.com/x")).toThrow(/URL_HOST_NOT_ALLOWED/);
  });
  it("hiányzó konfig: zárt – wildcard supabase.co sem megy át", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(() => assertAllowedUrl("https://anything.supabase.co/x")).toThrow(/URL_HOST_NOT_ALLOWED/);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefgh.supabase.co";
  });
  it("http own-config → teljesen zárt", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://internal.supabase.co";
    expect(() => assertAllowedUrl("http://internal.supabase.co/x")).toThrow();
    expect(() => assertAllowedUrl("https://internal.supabase.co/x")).toThrow(/URL_HOST_NOT_ALLOWED/);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefgh.supabase.co";
  });
});

describe("WaveSpeed output CDN", () => {
  const url = "https://cdn.cachegalaxy.com/output/image.png";
  it("allows the exact CDN only as a WaveSpeed provider output", () => {
    expect(assertAllowedProviderOutputUrl(url, "wavespeed").hostname).toBe("cdn.cachegalaxy.com");
    expect(() => assertAllowedUrl(url)).toThrow();
    expect(() => assertAllowedProviderOutputUrl(url, "fal")).toThrow();
  });
  it("rejects lookalikes, insecure URLs, credentials and nonstandard ports", () => {
    for (const bad of ["https://cdn.cachegalaxy.com.evil.example/x", "http://cdn.cachegalaxy.com/x", "https://user:pass@cdn.cachegalaxy.com/x", "https://cdn.cachegalaxy.com:8443/x"]) {
      expect(() => assertAllowedProviderOutputUrl(bad, "wavespeed")).toThrow();
    }
  });
});
