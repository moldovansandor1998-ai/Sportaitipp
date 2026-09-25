// training-prep (INTEGRATION=1): VALÓDI feltöltés a references bucketbe, >8MB ZIP-ág
// (imagesZipUrl), ZIP a claim ELŐTT létrejön, TRAINING_ALREADY_ACTIVE-nál a második ZIP eltűnik,
// a kötött verzió marad – nincs árva character_versions sor.
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const ENABLED = Boolean(process.env.INTEGRATION && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe.skipIf(!ENABLED)("training-prep: ZIP-életciklus és hibaág-takarítás", () => {
  let sb: SupabaseClient;
  let userId: string;
  let characterId: string;
  let token: string;

  const zipCount = async () => {
    const { data } = await sb.storage.from("assets").list(`${userId}/training/${characterId}`, { limit: 100 });
    return ((data ?? []) as Array<{ name: string }>).filter((o) => o.name.endsWith(".zip")).length;
  };

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.SUPABASE_URL;
    sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const email = `prep-${Date.now()}@castora.test`;
    await sb.auth.admin.createUser({ email, password: "Prep-pass-123", email_confirm: true });
    const anon = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const signIn = await anon.auth.signInWithPassword({ email, password: "Prep-pass-123" });
    token = signIn.data.session!.access_token;
    userId = (await anon.auth.getUser(token)).data.user!.id;
    const { data: c } = await sb.from("characters").insert({
      owner_id: userId, name: `Prep-${Date.now()}`, consent_type: "ai_persona", status: "ready_to_train",
    }).select("id").single();
    characterId = (c as { id: string }).id;
    await sb.from("credit_accounts").update({ balance: 700 }).eq("user_id", userId);   // 300-as hold fedezete

    // 3 db VALÓDI JPEG (~3,2 MB egyenként) feltöltése a references bucketbe → ZIP > 8 MB
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3.2 * 1024 * 1024, 7)]);
    for (let i = 0; i < 3; i++) {
      const objectPath = `${userId}/prep-${Date.now()}-${i}.jpg`;
      const { error: upErr } = await sb.storage.from("references").upload(objectPath, jpeg, { contentType: "image/jpeg" });
      if (upErr) throw new Error(upErr.message);
      const { data: a } = await sb.from("assets").insert({
        owner_id: userId, bucket: "references", object_path: objectPath,
        media_type: "image", content_type: "image/jpeg", bytes: jpeg.length,
        sha256: `prep-${i}-${Date.now()}`, source: "upload",
      }).select("id").single();
      await sb.from("character_reference_images").insert({
        character_id: characterId, asset_id: (a as { id: string }).id, kind: "face", qc_status: "approved",
      });
    }
  }, 180_000);

  it("prep#1 ZIP-ág sikeres + kötés; prep#2 claim-hiba után a ZIP eltűnik, nincs árva verzió", async () => {
    const { NextRequest } = await import("next/server");
    const handler = (await import("@/app/api/characters/[id]/training-prep/route")).POST;
    const mk = () => new NextRequest(`http://localhost/api/characters/${characterId}/training-prep`, {
      method: "POST", headers: { authorization: `Bearer ${token}` },
    });

    // 1) első prep: >8MB → imagesZipUrl ág, ZIP FELTÖLTŐDIK (a claim előtt létrejön)
    const r1 = await handler(mk(), { params: Promise.resolve({ id: characterId }) });
    expect(r1.status).toBe(200);
    const b1 = await r1.json() as { payload: { imagesZipUrl?: string; imagesDataUrl?: string; versionId: string; destination: string } };
    expect(b1.payload.imagesZipUrl).toBeTruthy();          // bizonyítva: a ZIP-ág futott
    expect(b1.payload.imagesDataUrl).toBeUndefined();
    expect(await zipCount()).toBe(1);                      // a ZIP ténylegesen létrejött

    // 2) valódi kötés: job létrehozás a versionId-vel (create_job_with_hold) – így a verzió NEM árva
    const { data: jobId } = await sb.rpc("create_job_with_hold", {
      p_owner: userId, p_type: "character_training", p_character: characterId, p_project: null,
      p_payload: {
        destination: b1.payload.destination ?? "e2e/dst",
        imagesZipUrl: b1.payload.imagesZipUrl,
        versionId: b1.payload.versionId,
      },
      p_key: `prepjob-${Date.now()}`, p_estimated: 300,
    });
    expect(jobId).toBeTruthy();
    const { data: ver } = await sb.from("character_versions").select("status,generation_job_id")
      .eq("id", b1.payload.versionId).single();
    expect(ver).toMatchObject({ status: "training" });
    expect((ver as { generation_job_id: string | null }).generation_job_id).toBe(jobId as string);

    // 3) második prep: az aktív attempt miatt claim-hiba → a feltöltött ZIP törlődik
    const r2 = await handler(mk(), { params: Promise.resolve({ id: characterId }) });
    expect(r2.status).toBe(409);
    const b2 = await r2.json() as { error?: string };
    expect(b2.error).toBe("TRAINING_ALREADY_ACTIVE");
    expect(await zipCount()).toBe(1);                      // a második ZIP eltűnt; az első (kötött) marad

    // 4) nincs árva verzió: a karakternek pontosan egy verziója van, az kötött
    const { data: all } = await sb.from("character_versions").select("id,status,generation_job_id")
      .eq("character_id", characterId);
    expect((all ?? [])).toHaveLength(1);
    expect((all as Array<{ status: string }>)[0].status).not.toBe("failed");
  }, 180_000);
});
