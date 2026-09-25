// Idempotency-kulcs életciklus: minden attempt új kulcsot KAP, a hálózati újraküldés ugyanazt
// használja, a felhasználói retry újat; dupla indítás gátolt.
export interface AttemptTracker {
  current(): string | null;      // aktuális attempt kulcsa (null = nincs futó attempt)
  begin(): string | null;        // indítás: ha már fut, null (dupla kattintás gát)
  resend(): string | null;       // hálózati újraküldés: ugyanaz a kulcs
  finish(): void;                // siker/hiba lezárás – a következő begin ÚJ kulcsot ad
}

export function createAttemptTracker(gen: () => string = () => crypto.randomUUID()): AttemptTracker {
  let key: string | null = null;
  return {
    current: () => key,
    begin: () => (key !== null ? null : (key = gen())),
    resend: () => key,
    finish: () => { key = null; },
  };
}
