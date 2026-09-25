// TELJES mock E2E folyamat valós (helyi) Supabase ellen:
// regisztráció → karakter → referencia → QC → tréning → tesztkép → identity → active → generálás → galéria → kredit
// CI-ban (INTEGRATION=1) kötelező a környezet – hiányában HIBA, nem skip!
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

if (process.env.INTEGRATION) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("INTEGRATION=1, de SUPABASE_URL vagy SUPABASE_SERVICE_ROLE_KEY hiányzik – a teszt nem skipelhető!");
  }
}

const COSTS: Record<string, number> = {
  reference_qc: 5, character_training: 300, test_image: 10, identity_check: 5, image_generation: 20,
};

describe.skipIf(!process.env.INTEGRATION)("E2E: teljes mock karakterfolyamat", () => {
  let sb: SupabaseClient;
  let userId: string;
  let characterId: string;
  let character2Id: string;
  const refIds: string[] = [];

  const balance = async (uid: string) =>
    ((await sb.from("credit_accounts").select("balance").eq("user_id", uid).single()).data as { balance: number }).balance;

  async function makeCharacter(name: string): Promise<string> {
    const { data: c } = await sb.from("characters").insert({
      owner_id: userId, name, consent_type: "ai_persona", status: "collecting_refs",
    }).select("id").single();
    return (c as { id: string }).id;
  }

  async function addRefs(cid: string, n: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const { data: a } = await sb.from("assets").insert({
        owner_id: userId, bucket: "references", object_path: `${userId}/${cid}-${i}.jpg`,
        media_type: "image", content_type: "image/jpeg", bytes: 1000 + i,
        sha256: `${cid}-${i}-${Date.now()}`, source: "upload",
      }).select("id").single();
      const { data: r } = await sb.from("character_reference_images").insert({
        character_id: cid, asset_id: (a as { id: string }).id, kind: "face",
      }).select("id").single();
      ids.push((r as { id: string }).id);
    }
    return ids;
  }

  async function createJobWithHoldRaw(
    uid: string, type: string, cid: string | undefined,
    payload: Record<string, unknown>, key: string, cost: number,
  ) {
    const { createJobWithHold } = await import("@/lib/credits/rpc");
    return createJobWithHold({ userId: uid, type, characterId: cid, payload, idempotencyKey: key, costEstimate: cost });
  }

  async function startJob(uid: string, type: string, cid: string | undefined, payload: Record<string, unknown>) {
    return createJobWithHoldRaw(uid, type, cid, payload, crypto.randomUUID(), COSTS[type] ?? 10);
  }

  async function runStep(type: string, payload: Record<string, unknown> = {}): Promise<void> {
    const { kickJob } = await import("@/server/jobs/runJob");
    const jobId = await startJob(userId, type, characterId, payload);
    await kickJob(jobId);
    const { data: job } = await sb.from("generation_jobs").select("status,error").eq("id", jobId).single();
    const j = job as { status: string; error: { message?: string } | null };
    expect(j.status).toBe("completed");
  }

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.SUPABASE_URL;
    sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const email = `e2e-${Date.now()}@castora.test`;
    const { data: user, error } = await sb.auth.admin.createUser({
      email, password: "E2e-pass-12345", email_confirm: true,
    });
    if (error) throw new Error(error.message);
    userId = user.user!.id;

    // E2E keret: 200 induló + 500 tesztkredit (a teljes folyamat 340-be kerül)
    const { error: balErr } = await sb.from("credit_accounts")
      .update({ balance: 700 }).eq("user_id", userId);
    if (balErr) throw new Error(balErr.message);

    characterId = await makeCharacter("E2E karakter");
    character2Id = await makeCharacter("E2E negatív karakter");
    refIds.push(...await addRefs(characterId, 3));
    await addRefs(character2Id, 3);
  }, 120_000);

  afterAll(async () => {
    if (userId) await sb.auth.admin.deleteUser(userId);
  }, 60_000);

  it("negatív esetek: árva job és jogosulatlan hold nélkül elutasítva", async () => {
    // üres refIds
    await expect(startJob(userId, "reference_qc", character2Id, {}))
      .rejects.toThrow(/REFS_INVALID/);
    // idegen refId
    await expect(startJob(userId, "reference_qc", character2Id,
      { refIds: [crypto.randomUUID()] })).rejects.toThrow(/REF_NOT_OWNED/);
    // nem létező karakter
    await expect(startJob(userId, "reference_qc", crypto.randomUUID(), { refIds: ["x"] }))
      .rejects.toThrow(/CHARACTER_NOT_OWNED/);
    // test_image a folyamat elején (nincs test_pending verzió)
    await expect(startJob(userId, "test_image", character2Id, {}))
      .rejects.toThrow(/CHARACTER_NOT_TEST_PENDING|NO_VERSION/);
    // generálás nem aktív karakterre
    await expect(startJob(userId, "image_generation", character2Id, { prompt: "x" }))
      .rejects.toThrow(/CHARACTER_NOT_ACTIVE/);
    // elégtelen fedezet: INSUFFICIENT_CREDITS, árva job és hold nélkül
    const refs2 = (await sb.from("character_reference_images").select("id").eq("character_id", character2Id)).data as { id: string }[];
    await sb.from("credit_accounts").update({ balance: 3 }).eq("user_id", userId);
    const key = crypto.randomUUID();
    await expect(createJobWithHoldRaw(userId, "reference_qc", character2Id, { refIds: refs2.map((r) => r.id) }, key, 5))
      .rejects.toThrow(/INSUFFICIENT_CREDITS/);
    const { data: orphans } = await sb.from("generation_jobs")
      .select("id,status").eq("character_id", character2Id).eq("type", "reference_qc");
    expect((orphans ?? []).filter((j: { status: string }) => j.status === "awaiting_credit")).toHaveLength(0);
    await sb.from("credit_accounts").update({ balance: 700 }).eq("user_id", userId);
  }, 120_000);

  it("a teljes folyamat pontos kreditelszámolással végigfut", async () => {
    expect(await balance(userId)).toBe(700);

    await runStep("reference_qc", { refIds });
    expect(await balance(userId)).toBe(695); // -5
    const ch = (await sb.from("characters").select("status").eq("id", characterId).single()).data as { status: string };
    expect(ch.status).toBe("ready_to_train");

    // Tréning: prep/claim (versionId) – a mock E2E közvetlenül claimeli, a route-tesztek fedik a HTTP-ágot
    const { data: claim } = await sb.rpc("claim_character_version", {
      p_character: characterId, p_provider: "mock", p_job: null,
      p_destination: null, p_dataset_path: null, p_preparation_key: `e2e-${Date.now()}`,
    });
    const versionId = (claim as { version_id: string }).version_id;
    await runStep("character_training", {
      destination: "e2e/mock-destination", imagesDataUrl: "data:application/zip;base64,AAAA",
      triggerWord: "char_e2e", steps: 1000, versionId,
    });
    expect(await balance(userId)).toBe(395); // -300
    const ver = (await sb.from("character_versions").select("*").eq("character_id", characterId).single()).data as
      { status: string; test_image_asset_id: string | null };
    expect(ver.status).toBe("test_pending");

    await runStep("test_image");
    expect(await balance(userId)).toBe(385); // -10
    const ver2 = (await sb.from("character_versions").select("test_image_asset_id").eq("character_id", characterId).single()).data as
      { test_image_asset_id: string | null };
    expect(ver2.test_image_asset_id).not.toBeNull();

    await runStep("identity_check");
    expect(await balance(userId)).toBe(380); // -5
    const chActive = (await sb.from("characters").select("status,active_version_id").eq("id", characterId).single()).data as unknown as
      { status: string; active_version_id: string | null };
    expect(chActive.status).toBe("active");
    const ver3 = (await sb.from("character_versions").select("identity_score,status").eq("id", chActive.active_version_id!).single()).data as
      { identity_score: number; status: string };
    expect(ver3.identity_score).toBe(0.95);

    await runStep("image_generation", { prompt: "e2e" });
    expect(await balance(userId)).toBe(360); // -20, pontosan 340 összköltség
    const { data: gallery } = await sb.from("gallery_items").select("id").eq("character_id", characterId).is("deleted_at", null);
    expect((gallery ?? []).length).toBeGreaterThan(0);

    // a generálás a mock-provideres verzióval is megy (mock dev-motor), de active karakter kell –
    // a mock flow itt már nem aktivál: a fenti elvárások a valós ágat tükrözik
  }, 180_000);
});
