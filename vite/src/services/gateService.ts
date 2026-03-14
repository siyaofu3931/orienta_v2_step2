import type { Gate, LatLng } from "./types";
import { buildT3EGates, T3E_SPINE_CENTER } from "./passengerSim";

export const PEK_T3_CENTER: LatLng = T3E_SPINE_CENTER;

export async function loadGates(): Promise<{ gates: Gate[]; source: "t3e_hardcoded" | "overpass" | "synthetic" }> {
  // Always use hardcoded T3E gates for I→I PoC
  const gates = buildT3EGates();
  return { gates, source: "t3e_hardcoded" };
}
