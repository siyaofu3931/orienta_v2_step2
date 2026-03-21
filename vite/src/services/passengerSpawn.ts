/** Demo lounge pin (PEK T3E area) — matches mock airport lounge QR. */
export const MOCK_LOUNGE_SPAWN = { lat: 40.077095, lng: 116.606151 } as const;

export type SpawnPoint = { lat: number; lng: number };

/** Parse spawn from URL (?lounge=1 | ?spawn=lounge | ?spawnLat=&spawnLng=). */
export function parseSpawnFromQuery(getter: (name: string) => string | null): SpawnPoint | null {
  const latS = getter("spawnLat");
  const lngS = getter("spawnLng");
  if (latS && lngS) {
    const lat = parseFloat(latS);
    const lng = parseFloat(lngS);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  if (getter("lounge") === "1" || getter("spawn") === "lounge") {
    return { lat: MOCK_LOUNGE_SPAWN.lat, lng: MOCK_LOUNGE_SPAWN.lng };
  }
  return null;
}

export function appendSpawnParams(u: URL, spawn: SpawnPoint | null) {
  if (!spawn) return;
  u.searchParams.set("spawnLat", String(spawn.lat));
  u.searchParams.set("spawnLng", String(spawn.lng));
}
