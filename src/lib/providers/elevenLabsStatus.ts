/** Never forward a provider's arbitrary response body, credentials or account details. */
export async function elevenLabsErrorCode(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { detail?: { status?: unknown; code?: unknown }; code?: unknown } | null;
  const raw = body?.detail?.status ?? body?.detail?.code ?? body?.code;
  return typeof raw === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(raw) ? raw : `http_${response.status}`;
}

export function elevenLabsErrorMessage(code: string, status: number): string {
  const messages: Record<string, string> = {
    invalid_api_key: "Az ElevenLabs API-kulcs érvénytelen vagy lejárt. Az adminnak újra be kell állítania a kapcsolatot.",
    authentication_error: "Az ElevenLabs nem fogadja el az API-kulcsot. Az adminnak ellenőriznie kell a kapcsolatot.",
    missing_permissions: "Az ElevenLabs API-kulcsnak nincs jogosultsága ehhez a művelethez.",
    quota_exceeded: "Elfogyott az ElevenLabs beszédkerete. A szolgáltatói keretet fel kell tölteni.",
    payment_issue: "Az ElevenLabs-fiók számlázási problémája miatt nem készíthető beszéd.",
    voice_not_found: "A modellhez beállított hang nem érhető el ebben az ElevenLabs-fiókban.",
    model_not_found: "A kért beszédmodell nem érhető el ebben az ElevenLabs-fiókban.",
  };
  return `${messages[code] ?? "A modell hangja nem készült el."} (ElevenLabs ${status}; ${code})`;
}

type SpeechHealth = { configured: boolean; authenticated?: boolean; available: boolean; code?: string };
let cached: { key: string; until: number; result: SpeechHealth } | undefined;

/** Free, read-only provider check. Public result contains health flags only, never account data. */
export async function elevenLabsSpeechHealth(): Promise<SpeechHealth> {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) return { configured: false, available: false, code: "not_configured" };
  if (cached?.key === key && cached.until > Date.now()) return cached.result;
  try {
    const headers = { "xi-api-key": key };
    const response = await fetch("https://api.elevenlabs.io/v1/models", { headers, signal: AbortSignal.timeout(15_000), cache: "no-store" });
    if (!response.ok) {
      const result = { configured: true, authenticated: false, available: false, code: await elevenLabsErrorCode(response) };
      cached = { key, until: Date.now() + 60_000, result }; return result;
    }
    // Subscription read may be forbidden on a deliberately restricted TTS key.
    // That does not invalidate an otherwise authenticated connection.
    const subscription = await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers, signal: AbortSignal.timeout(15_000), cache: "no-store" });
    let code: string | undefined;
    if (subscription.ok) {
      const data = await subscription.json() as { character_count?: number; character_limit?: number; status?: string; can_extend_character_limit?: boolean };
      if (data.status === "past_due" || data.status === "unpaid") code = "payment_issue";
      else if (typeof data.character_count === "number" && typeof data.character_limit === "number"
        && data.character_count >= data.character_limit && data.can_extend_character_limit === false) code = "quota_exceeded";
    }
    const result = { configured: true, authenticated: true, available: !code, ...(code ? { code } : {}) };
    cached = { key, until: Date.now() + 60_000, result }; return result;
  } catch { return { configured: true, available: false, code: "unavailable" }; }
}
