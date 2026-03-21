/**
 * Boarding-pass / QR passenger codes → canonical sim + WebSocket ids (TX1…).
 * Canonical profiles stay TX1 / TX2 / TX3 in passengerSim.
 */
const ALIAS_TO_CANONICAL: Record<string, string> = {
  DA8X3: "TX1", // Siyao Fu
  DB5K7: "TX2", // Sophie Chen
  DC2N9: "TX3", // Yan Jiang
};

/** Empty input → "" (caller supplies default). */
export function resolveCanonicalPassengerId(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  const key = s.toUpperCase();
  return ALIAS_TO_CANONICAL[key] ?? s;
}
