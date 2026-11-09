import { describe, expect, it } from "vitest";
import { assertLocalIntegrationTarget } from "./helpers/localIntegration";
const env = () => ({ INTEGRATION: "1", NODE_ENV: "test", SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "local-service-fixture", NEXT_PUBLIC_SUPABASE_ANON_KEY: "local-anon-fixture" });
describe("local-only legacy integration fixtures", () => {
  it("permits the disposable local Supabase endpoint", () => expect(() => assertLocalIntegrationTarget(env())).not.toThrow());
  it.each(["https://example.supabase.co", "http://127.0.0.1:54322", "https://127.0.0.1:54321", "http://127.0.0.1:54321/path", "http://127.0.0.1:54321?token=fixture", "http://fixture@127.0.0.1:54321"])("rejects an unsafe target %s", url => {
    expect(() => assertLocalIntegrationTarget({ ...env(), SUPABASE_URL: url })).toThrow();
  });
  it.each(["FAL_KEY", "REPLICATE_API_TOKEN", "WAVESPEED_API_KEY", "NURETA_API_KEY", "ELEVENLABS_API_KEY"])("rejects paid provider credentials %s", key => {
    expect(() => assertLocalIntegrationTarget({ ...env(), [key]: "fixture" })).toThrow("PAID_PROVIDER_KEY_PRESENT");
  });
  it("requires matching local origins, test mode and distinct nonempty keys", () => {
    for (const change of [{ INTEGRATION: "" }, { NODE_ENV: "production" }, { PROVIDER_ALLOW_MOCK: "false" }, { NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" }, { NEXT_PUBLIC_SUPABASE_ANON_KEY: "" }, { NEXT_PUBLIC_SUPABASE_ANON_KEY: "local-service-fixture" }])
      expect(() => assertLocalIntegrationTarget({ ...env(), ...change })).toThrow();
  });
});
