import { afterEach, describe, expect, it, vi } from "vitest";
import { legacyCharacterVoice, resolveCharacterVoice } from "@/server/jobs/characterVoice";
import type { serviceClient } from "@/lib/supabase/server";
afterEach(() => vi.unstubAllEnvs());
describe("Saved character voices", () => {
  it("retains the existing swapped Zsofia/Dorika assignments", () => {
    vi.stubEnv("ELEVENLABS_DORA_VOICE_ID", "zsofia-voice");
    vi.stubEnv("ELEVENLABS_ZSOFI_VOICE_ID", "dorika-voice");
    expect(legacyCharacterVoice("Zsófia")).toEqual({ voiceId: "zsofia-voice", hungarianTts: true });
    expect(legacyCharacterVoice("Dorika")).toEqual({ voiceId: "dorika-voice", hungarianTts: false });
  });
  it("uses stored voice after renaming and scopes its query to the owner", async () => {
    const chain = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
    chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain);
    chain.maybeSingle.mockResolvedValue({ data: { name: "Renamed model", elevenlabs_voice_id: "persisted-voice", elevenlabs_hungarian_tts: true }, error: null });
    const sb = { from: vi.fn().mockReturnValue(chain) } as unknown as ReturnType<typeof serviceClient>;
    expect(await resolveCharacterVoice(sb, "character-id", "owner-id")).toEqual({ voiceId: "persisted-voice", hungarianTts: true });
    expect(chain.eq).toHaveBeenCalledWith("owner_id", "owner-id");
    expect(chain.eq).toHaveBeenCalledWith("id", "character-id");
  });
});
