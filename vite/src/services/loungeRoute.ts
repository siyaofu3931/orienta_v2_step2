import { resolveCanonicalPassengerId } from "./passengerAliases";

/**
 * QR format: /lounge?lat=40.077095&lng=116.606151
 * Rewrites to /pax with pid default P11 and spawn coords so the ops map shows that passenger at the lounge.
 */
export function normalizeLoungePathToPax(): void {
  if (typeof window === "undefined") return;
  if (!window.location.pathname.startsWith("/lounge")) return;

  const sp = new URLSearchParams(window.location.search);
  const lat = parseFloat(sp.get("lat") || "");
  const lng = parseFloat(sp.get("lng") || "");
  const rawPid = (sp.get("pid") || sp.get("pax") || "P11").trim();
  const tenant = sp.get("tenant") || "airchina";

  const u = new URL("/pax", window.location.origin);
  u.searchParams.set("pid", resolveCanonicalPassengerId(rawPid) || rawPid);
  u.searchParams.set("tenant", tenant);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    u.searchParams.set("spawnLat", String(lat));
    u.searchParams.set("spawnLng", String(lng));
  } else {
    u.searchParams.set("lounge", "1");
  }
  if (sp.get("direct") === "1") u.searchParams.set("direct", "1");
  if (sp.get("skip") === "1") u.searchParams.set("skip", "1");

  window.history.replaceState(null, "", u.pathname + u.search);
}
