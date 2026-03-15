import type { Flight, Gate, Passenger, PassengerComputed, PassengerStatus, GateStats, LatLng, PaxPlan, PaxExtStatus } from "./types";
import { clamp, haversineMeters, makePolyline, randPick } from "./utils";

// ──────────────────────────────────────────────
// T3E Gate coordinates (E01-E36 approximate positions)
// Based on real PEK T3E layout - all inside the brown terminal building
// T3E runs roughly N-S, gates on both sides of the spine
// ──────────────────────────────────────────────
// Center computed from OSM gate centroid
export const T3E_SPINE_CENTER: LatLng = { lat: 40.0748162, lng: 116.6061088 };

// ── T3E gate coordinates — source: OpenStreetMap Overpass API (aeroway=gate, Feb 2026) ──
// query: node[aeroway=gate](40.060,116.590,40.085,116.620)
// Shared-gate nodes (e.g. "E01;E02") are split to individual IDs at the same coordinate.
const T3E_GATE_COORDS: Record<string, LatLng> = {
  "E01": { lat: 40.0698778, lng: 116.6078785 },
  "E02": { lat: 40.0698778, lng: 116.6078785 },
  "E03": { lat: 40.0707040, lng: 116.6077329 },
  "E04": { lat: 40.0707040, lng: 116.6077329 },
  "E05": { lat: 40.0716972, lng: 116.6075757 },
  "E06": { lat: 40.0716972, lng: 116.6075757 },
  "E07": { lat: 40.0725621, lng: 116.6074109 },
  "E08": { lat: 40.0733074, lng: 116.6073059 },
  "E09": { lat: 40.0741810, lng: 116.6071724 },
  "E10": { lat: 40.0751136, lng: 116.6071221 },
  "E11": { lat: 40.0759157, lng: 116.6072787 },
  "E12": { lat: 40.0766563, lng: 116.6076803 },
  "E13": { lat: 40.0774799, lng: 116.6084715 },
  "E14": { lat: 40.0779452, lng: 116.6091795 },
  "E15": { lat: 40.0794489, lng: 116.6100024 },
  "E16": { lat: 40.0791242, lng: 116.6095203 },
  "E17": { lat: 40.0787616, lng: 116.6088537 },
  "E18": { lat: 40.0784020, lng: 116.6081910 },
  "E19": { lat: 40.0780400, lng: 116.6075435 },
  "E20": { lat: 40.0774733, lng: 116.6044201 },
  "E21": { lat: 40.0776957, lng: 116.6036565 },
  "E22": { lat: 40.0779409, lng: 116.6029138 },
  "E23": { lat: 40.0781821, lng: 116.6021727 },
  "E24": { lat: 40.0784103, lng: 116.6014201 },
  "E25": { lat: 40.0775324, lng: 116.6014014 },
  "E26": { lat: 40.0772470, lng: 116.6022891 },
  "E27": { lat: 40.0767272, lng: 116.6034503 },
  "E28": { lat: 40.0761525, lng: 116.6041812 },
  "E29": { lat: 40.0754611, lng: 116.6047395 },
  "E30": { lat: 40.0745852, lng: 116.6051611 },
  "E31": { lat: 40.0738661, lng: 116.6052917 },
  "E32": { lat: 40.0729995, lng: 116.6054142 },
  "E33": { lat: 40.0723848, lng: 116.6055246 },
  "E34": { lat: 40.0718901, lng: 116.6056069 },
  "E35": { lat: 40.0711442, lng: 116.6057220 },
  "E36": { lat: 40.0703919, lng: 116.6058220 },
  "E51": { lat: 40.0723476, lng: 116.6071613 },
  "E52": { lat: 40.0721973, lng: 116.6071716 },
  "E53": { lat: 40.0720272, lng: 116.6071923 },
  "E57": { lat: 40.0734809, lng: 116.6060757 },
  "E58": { lat: 40.0733306, lng: 116.6060860 },
  "E59": { lat: 40.0731605, lng: 116.6061067 },
  "E60": { lat: 40.0723021, lng: 116.6062101 },
  "E61": { lat: 40.0721518, lng: 116.6062204 },
  "E62": { lat: 40.0719817, lng: 116.6062411 },
};

// Shopping/dining areas inside T3E spine (between E07-E12 corridor)
const INDOOR_AMENITIES: LatLng[] = [
  { lat: 40.0742, lng: 116.6065 }, // central atrium near E09/E30
  { lat: 40.0730, lng: 116.6063 }, // food court near E32/E59
  { lat: 40.0722, lng: 116.6065 }, // coffee shop near E33/E53
  { lat: 40.0755, lng: 116.6067 }, // duty free near E10/E11
  { lat: 40.0769, lng: 116.6050 }, // lounge near E20/E27
  { lat: 40.0710, lng: 116.6064 }, // south gallery near E35/E36
];

// Transfer security checkpoint (Level 3 -> Level 2 transition)
const TRANSFER_SECURITY: LatLng = { lat: 40.0750, lng: 116.5985 };

// ──────────────────────────────────────────────
// Real I→I International flights through PEK T3E
// Based on Air China international-to-international connections at T3E
// ──────────────────────────────────────────────
const INTL_INBOUND_FLIGHTS = [
  { id: "CA836", from: "LHR", fromCity: "London", arr: -85 },   // arrived 85 min ago
  { id: "CA856", from: "FRA", fromCity: "Frankfurt", arr: -70 },
  { id: "CA901", from: "NRT", fromCity: "Tokyo", arr: -60 },
  { id: "CA902", from: "ICN", fromCity: "Seoul", arr: -55 },
  { id: "CA921", from: "SYD", fromCity: "Sydney", arr: -90 },
  { id: "CA931", from: "LAX", fromCity: "Los Angeles", arr: -95 },
  { id: "CA841", from: "CDG", fromCity: "Paris", arr: -75 },
  { id: "CA861", from: "AMS", fromCity: "Amsterdam", arr: -65 },
];

const INTL_OUTBOUND_FLIGHTS: Array<{
  id: string; to: string; toCity: string;
  gate: string; depOffset: number; status: "Gate Open" | "Boarding" | "Final Call" | "Closed" | "Delayed"
}> = [
  { id: "CA783", to: "FRA", toCity: "Frankfurt", gate: "E15", depOffset: 55, status: "Gate Open" },
  { id: "CA837", to: "LHR", toCity: "London", gate: "E19", depOffset: 40, status: "Boarding" },
  { id: "CA781", to: "CDG", toCity: "Paris", gate: "E22", depOffset: 25, status: "Final Call" },
  { id: "CA831", to: "AMS", toCity: "Amsterdam", gate: "E26", depOffset: 70, status: "Gate Open" },
  { id: "CA903", to: "NRT", toCity: "Tokyo", gate: "E12", depOffset: 50, status: "Boarding" },
  { id: "CA935", to: "LAX", toCity: "Los Angeles", gate: "E08", depOffset: 90, status: "Gate Open" },
  { id: "CA911", to: "SYD", toCity: "Sydney", gate: "E05", depOffset: 35, status: "Boarding" },
  { id: "CA921", to: "ICN", toCity: "Seoul", gate: "E30", depOffset: 45, status: "Boarding" },
  { id: "CA741", to: "MNL", toCity: "Manila", gate: "E33", depOffset: -20, status: "Closed" },   // missed!
  { id: "CA861", to: "SIN", toCity: "Singapore", gate: "E36", depOffset: -15, status: "Closed" }, // missed!
];

// ──────────────────────────────────────────────
// Passenger profiles - international travelers for I→I
// ──────────────────────────────────────────────
const PROFILES = [
  // Premium passengers (TX1, TX2, P3, P7, P11, P15, P21, P27)
  { id: "TX1", name: "Siyao Fu",    nat: "CN", locale: "zh-CN", plan: "premium" as PaxPlan, wheelchair: false },
  { id: "TX2", name: "Sophie Chen", nat: "HK", locale: "zh-HK", plan: "premium" as PaxPlan, wheelchair: false },
  { id: "TX3", name: "Yan Jiang",   nat: "CN", locale: "zh-CN", plan: "premium" as PaxPlan, wheelchair: false },
  { id: "P3",  name: "Anna Müller",  nat: "DE", locale: "de-DE", plan: "premium" as PaxPlan, wheelchair: true },
  { id: "P4",  name: "Raj Patel",    nat: "IN", locale: "en-IN", plan: "free"    as PaxPlan, wheelchair: false },
  { id: "P5",  name: "Yuki Tanaka",  nat: "JP", locale: "ja-JP", plan: "free"    as PaxPlan, wheelchair: false },
  { id: "P6",  name: "Omar Al-Said", nat: "AE", locale: "ar-AE", plan: "free"    as PaxPlan, wheelchair: false },
  { id: "P7",  name: "Emily Johnson",nat: "US", locale: "en-US", plan: "premium" as PaxPlan, wheelchair: false },
  { id: "P8",  name: "Ivan Petrov",  nat: "RU", locale: "ru-RU", plan: "free"    as PaxPlan, wheelchair: false },
  { id: "P9",  name: "Min-ji Kim",   nat: "KR", locale: "ko-KR", plan: "free"    as PaxPlan, wheelchair: false },
  { id: "P10", name: "François Martin", nat: "FR", locale: "fr-FR", plan: "free" as PaxPlan, wheelchair: false },
  { id: "P11", name: "Isabella Romano", nat: "IT", locale: "it-IT", plan: "premium" as PaxPlan, wheelchair: true },
  { id: "P12", name: "Ahmed Hassan", nat: "EG", locale: "ar-EG", plan: "free"    as PaxPlan, wheelchair: false },
  { id: "P13", name: "Zara Williams", nat: "AU", locale: "en-AU", plan: "free"   as PaxPlan, wheelchair: false },
  { id: "P14", name: "Carlos García", nat: "ES", locale: "es-ES", plan: "free"   as PaxPlan, wheelchair: false },
  { id: "P15", name: "Lena Novak",   nat: "CZ", locale: "cs-CZ", plan: "premium" as PaxPlan, wheelchair: false },
  { id: "P16", name: "Fatima Al-Rashid", nat: "SA", locale: "ar-SA", plan: "free" as PaxPlan, wheelchair: true },
  { id: "P17", name: "Thomas Dubois", nat: "BE", locale: "fr-BE", plan: "free"   as PaxPlan, wheelchair: false },
  { id: "P18", name: "Aisha Okonkwo", nat: "NG", locale: "en-NG", plan: "free"   as PaxPlan, wheelchair: false },
  { id: "P19", name: "Sven Lindqvist", nat: "SE", locale: "sv-SE", plan: "free"  as PaxPlan, wheelchair: false },
  { id: "P20", name: "María Santos",  nat: "BR", locale: "pt-BR", plan: "free"   as PaxPlan, wheelchair: false },
  { id: "P21", name: "Henrik Larsen", nat: "DK", locale: "da-DK", plan: "premium" as PaxPlan, wheelchair: false },
  { id: "P22", name: "Priya Sharma",  nat: "IN", locale: "en-IN", plan: "free"   as PaxPlan, wheelchair: false },
  { id: "P23", name: "Jae-won Park",  nat: "KR", locale: "ko-KR", plan: "free"   as PaxPlan, wheelchair: false },
  { id: "P24", name: "Claudia Weber", nat: "DE", locale: "de-DE", plan: "free"   as PaxPlan, wheelchair: false },
  { id: "P25", name: "Peter Kovacs",  nat: "HU", locale: "hu-HU", plan: "free"   as PaxPlan, wheelchair: false },
  { id: "P26", name: "Nadia Rousseau", nat: "FR", locale: "fr-FR", plan: "free"  as PaxPlan, wheelchair: false },
  { id: "P27", name: "David Park",    nat: "US", locale: "en-US", plan: "premium" as PaxPlan, wheelchair: false },
  { id: "P28", name: "Mei Lin",       nat: "CN", locale: "zh-CN", plan: "free"   as PaxPlan, wheelchair: false },
  { id: "P29", name: "Stefan Braun",  nat: "AT", locale: "de-AT", plan: "free"   as PaxPlan, wheelchair: false },
  { id: "P30", name: "Anya Ivanova",  nat: "UA", locale: "uk-UA", plan: "free"   as PaxPlan, wheelchair: false },
];

// ──────────────────────────────────────────────
// Fixed passenger scenario assignments
// Carefully designed for PoC demonstration
// ──────────────────────────────────────────────
type PaxScenario = {
  extStatus: PaxExtStatus;
  activity: "moving" | "shopping" | "dining" | "idle" | "at_gate" | "boarded";
  outboundIdx: number; // index into INTL_OUTBOUND_FLIGHTS
  inboundIdx: number;  // index into INTL_INBOUND_FLIGHTS
  note: string;
};

const PAX_SCENARIOS: Record<string, PaxScenario> = {
  // PREMIUM USERS
  "TX1": { extStatus: "red",     activity: "shopping",  outboundIdx: 1, inboundIdx: 0, note: "Shopping - very tight connection to LHR" },
  "TX2": { extStatus: "yellow",  activity: "moving",    outboundIdx: 0, inboundIdx: 1, note: "Moving to gate - time getting tight" },
  "TX3": { extStatus: "red",     activity: "dining",    outboundIdx: 2, inboundIdx: 1, note: "At risk - Final Call flight, still dining" },
  "P3":  { extStatus: "green",   activity: "moving",    outboundIdx: 5, inboundIdx: 2, note: "♿ Wheelchair - moving with assistance" },
  "P7":  { extStatus: "green",   activity: "at_gate",   outboundIdx: 4, inboundIdx: 3, note: "Already at gate, waiting to board" },
  "P11": { extStatus: "lost",    activity: "idle",      outboundIdx: 3, inboundIdx: 4, note: "♿ Location signal lost in south wing" },
  "P15": { extStatus: "yellow",  activity: "dining",    outboundIdx: 2, inboundIdx: 5, note: "Dining - Final Call flight" },
  "P21": { extStatus: "green",   activity: "moving",    outboundIdx: 7, inboundIdx: 6, note: "On route to gate, good timing" },
  "P27": { extStatus: "offline", activity: "idle",      outboundIdx: 6, inboundIdx: 7, note: "No network - offline" },

  // FREE USERS - various scenarios
  "P4":  { extStatus: "green",   activity: "moving",    outboundIdx: 5, inboundIdx: 0, note: "On track" },
  "P5":  { extStatus: "yellow",  activity: "shopping",  outboundIdx: 4, inboundIdx: 1, note: "Browsing duty-free" },
  "P6":  { extStatus: "missed",  activity: "idle",      outboundIdx: 9, inboundIdx: 2, note: "Flight CA861→SIN already closed" },
  "P8":  { extStatus: "lost",    activity: "idle",      outboundIdx: 3, inboundIdx: 3, note: "Location lost - last seen south corridor" },
  "P9":  { extStatus: "offline", activity: "idle",      outboundIdx: 4, inboundIdx: 4, note: "No Wi-Fi access" },
  "P10": { extStatus: "offline", activity: "shopping",  outboundIdx: 5, inboundIdx: 5, note: "European SIM - no data" },
  "P12": { extStatus: "offline", activity: "idle",      outboundIdx: 6, inboundIdx: 6, note: "Data roaming disabled" },
  "P13": { extStatus: "green",   activity: "moving",    outboundIdx: 7, inboundIdx: 7, note: "Moving to gate" },
  "P14": { extStatus: "missed",  activity: "idle",      outboundIdx: 8, inboundIdx: 0, note: "Flight CA741→MNL already closed" },
  "P16": { extStatus: "green",   activity: "at_gate",   outboundIdx: 3, inboundIdx: 1, note: "♿ At gate with assistance" },
  "P17": { extStatus: "offline", activity: "idle",      outboundIdx: 5, inboundIdx: 2, note: "Offline - no network" },
  "P18": { extStatus: "red",     activity: "dining",    outboundIdx: 2, inboundIdx: 3, note: "Final Call - still dining" },
  "P19": { extStatus: "offline", activity: "idle",      outboundIdx: 6, inboundIdx: 4, note: "No connectivity" },
  "P20": { extStatus: "yellow",  activity: "idle",      outboundIdx: 4, inboundIdx: 5, note: "Resting near gate area" },
  "P22": { extStatus: "green",   activity: "moving",    outboundIdx: 0, inboundIdx: 6, note: "Heading to gate" },
  "P23": { extStatus: "offline", activity: "idle",      outboundIdx: 7, inboundIdx: 7, note: "Korean SIM - no data" },
  "P24": { extStatus: "lost",    activity: "idle",      outboundIdx: 1, inboundIdx: 0, note: "Location lost in north wing" },
  "P25": { extStatus: "offline", activity: "idle",      outboundIdx: 3, inboundIdx: 1, note: "No connection" },
  "P26": { extStatus: "lost",    activity: "shopping",  outboundIdx: 0, inboundIdx: 2, note: "Lost in duty free area" },
  "P28": { extStatus: "green",   activity: "boarded",   outboundIdx: 5, inboundIdx: 3, note: "Already boarded" },
  "P29": { extStatus: "offline", activity: "idle",      outboundIdx: 4, inboundIdx: 4, note: "Offline - Austrian SIM" },
  "P30": { extStatus: "missed",  activity: "idle",      outboundIdx: 9, inboundIdx: 5, note: "Flight already departed" },
};

// Extra missed passenger
const MISSED_IDS = new Set(["P6", "P14", "P30"]);
const LOST_IDS = new Set(["P8", "P11", "P24", "P26"]);
const OFFLINE_IDS = new Set(["P9", "P10", "P12", "P17", "P19", "P23", "P25", "P27", "P29"]);

function offsetMs(minutes: number) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function gateCoord(gateName: string): LatLng {
  return T3E_GATE_COORDS[gateName] || T3E_SPINE_CENTER;
}

function randomNearby(center: LatLng, maxM: number): LatLng {
  const dLat = (maxM / 111000) * (Math.random() * 2 - 1);
  const dLng = (maxM / (111000 * Math.cos(center.lat * Math.PI / 180))) * (Math.random() * 2 - 1);
  return { lat: center.lat + dLat, lng: center.lng + dLng };
}

// Clamp to T3E bounding box (all inside the brown area on OSM)
// BBOX derived from OSM gate extents + 50m padding
const T3E_BBOX = {
  minLat: 40.0694, maxLat: 40.0800,
  minLng: 116.6008, maxLng: 116.6108,
};

function clampToT3E(p: LatLng): LatLng {
  return {
    lat: clamp(p.lat, T3E_BBOX.minLat, T3E_BBOX.maxLat),
    lng: clamp(p.lng, T3E_BBOX.minLng, T3E_BBOX.maxLng),
  };
}

// ──────────────────────────────────────────────
// Build synthetic T3E gates (E02-E36 + selected)
// ──────────────────────────────────────────────
export function buildT3EGates(): Gate[] {
  return Object.entries(T3E_GATE_COORDS).map(([name, coord]) => ({
    id: name,
    name,
    coordinate: coord,
    tags: { ref: name, aeroway: "gate", terminal: "T3E" }
  }));
}

// ──────────────────────────────────────────────
// Build flights
// ──────────────────────────────────────────────
export function buildIntlFlights(): Flight[] {
  return INTL_OUTBOUND_FLIGHTS.map(f => ({
    id: f.id,
    callsign: f.id,
    destination: f.to,
    scheduledDep: offsetMs(f.depOffset),
    status: f.status,
    gateRef: f.gate,
    gateId: f.gate,
  }));
}

// ──────────────────────────────────────────────
// Create the world: 30 I→I passengers
// ──────────────────────────────────────────────
export function createWorld(_gates: Gate[], _flights: Flight[], _count: number): { passengers: Passenger[] } {
  const now = Date.now();
  const passengers: Passenger[] = [];

  for (const profile of PROFILES) {
    const scenario = PAX_SCENARIOS[profile.id];
    if (!scenario) continue;

    const outFlight = INTL_OUTBOUND_FLIGHTS[scenario.outboundIdx % INTL_OUTBOUND_FLIGHTS.length];
    const inFlight = INTL_INBOUND_FLIGHTS[scenario.inboundIdx % INTL_INBOUND_FLIGHTS.length];
    const gateCoordinate = gateCoord(outFlight.gate);

    // Determine location
    let location: LatLng;
    let path: LatLng[] | undefined;
    let pathIndex: number | undefined;

    if (scenario.extStatus === "missed") {
      // Missed - stopped near a gate or lounge
      location = clampToT3E(randomNearby(randPick(INDOOR_AMENITIES), 50));
    } else if (scenario.extStatus === "lost") {
      // Location is approximate / unknown - show last known
      location = clampToT3E(randomNearby(randPick(INDOOR_AMENITIES), 80));
    } else if (scenario.extStatus === "offline") {
      // Offline - static position near an amenity
      location = clampToT3E(randomNearby(randPick(INDOOR_AMENITIES), 100));
    } else if (scenario.activity === "at_gate" || scenario.activity === "boarded") {
      location = clampToT3E(randomNearby(gateCoordinate, 15));
    } else if (scenario.activity === "moving") {
      // Start from further inside the terminal
      const startAmenity = randPick(INDOOR_AMENITIES);
      const start = clampToT3E(randomNearby(startAmenity, 60));
      location = start;
      path = makePolyline(start, gateCoordinate, 12);
      pathIndex = 0;
    } else {
      // shopping/dining/idle - near an amenity
      location = clampToT3E(randomNearby(randPick(INDOOR_AMENITIES), 80));
    }

    const urgency = (scenario.extStatus === "red" || outFlight.depOffset < 30)
      ? "urgent" : "normal";

    passengers.push({
      id: profile.id,
      name: profile.name,
      nationality: profile.nat,
      locale: profile.locale,
      needsWheelchair: profile.wheelchair,
      plan: profile.plan,
      transfer: {
        direction: "intl_to_intl",
        urgency,
        inboundFlight: inFlight.id,
        inboundFrom: inFlight.from,
        inboundArr: offsetMs(inFlight.arr),
        outboundFlight: outFlight.id,
        outboundTo: outFlight.to,
        outboundDep: offsetMs(outFlight.depOffset),
        note: scenario.note,
      },
      flightId: outFlight.id,
      gateId: outFlight.gate,
      activity: scenario.activity,
      extStatus: scenario.extStatus,
      location,
      path,
      pathIndex,
      lastUpdateMs: now,
      locationLostAt: LOST_IDS.has(profile.id) ? now - 8 * 60 * 1000 : undefined,
    });
  }

  // Ensure Yan Jiang (TX3) is visible at top of lists: sort so TX3 is first
  passengers.sort((a, b) => (a.id === "TX3" ? 0 : 1) - (b.id === "TX3" ? 0 : 1));
  return { passengers };
}

// ──────────────────────────────────────────────
// Step simulation
// ──────────────────────────────────────────────
export function stepWorld(world: { passengers: Passenger[] }, gatesById: Map<string, Gate>, dtMs: number): { passengers: Passenger[] } {
  const next = world.passengers.map(p => {
    // Don't update missed, offline, lost, boarded, or at_gate passengers
    if (["missed", "offline", "lost"].includes(p.extStatus)) return p;
    if (p.activity === "boarded" || p.activity === "at_gate") return p;
    if (p.activity !== "moving" || !p.path || p.pathIndex == null) return p;

    const speedMps = p.needsWheelchair ? 0.80 : 1.20;
    let idx = p.pathIndex;
    let loc = p.location;
    let remainingDt = dtMs;

    while (remainingDt > 0 && idx < p.path.length - 1) {
      const a = p.path[idx];
      const b = p.path[idx + 1];
      const seg = haversineMeters(a, b);
      const segTime = (seg / speedMps) * 1000;

      if (remainingDt >= segTime) {
        idx += 1;
        loc = b;
        remainingDt -= segTime;
      } else {
        const t = clamp(remainingDt / segTime, 0, 1);
        loc = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
        remainingDt = 0;
      }
    }

    // Arrived at gate
    const gate = gatesById.get(p.gateId);
    if (gate && haversineMeters(loc, gate.coordinate) < 20) {
      return { ...p, location: gate.coordinate, activity: "at_gate" as const, extStatus: "green" as const, path: undefined, pathIndex: undefined, lastUpdateMs: Date.now() };
    }

    return { ...p, location: clampToT3E(loc), pathIndex: idx, lastUpdateMs: Date.now() };
  });

  return { passengers: next };
}

// ──────────────────────────────────────────────
// Compute passenger status for display
// ──────────────────────────────────────────────
export function computePassenger(p: Passenger, flight: Flight | null, gate: Gate | null): PassengerComputed {
  // Special states take priority
  if (p.extStatus === "missed") {
    return { ...p, etaMinutes: null, status: "gray", reason: "❌ Flight already departed" };
  }
  if (p.extStatus === "offline") {
    return { ...p, etaMinutes: null, status: "gray", reason: "📵 Offline - no network signal" };
  }
  if (p.extStatus === "lost") {
    return { ...p, etaMinutes: null, status: "gray", reason: "📍 Location lost - awaiting position report" };
  }

  if (!flight || !gate) {
    return { ...p, etaMinutes: null, status: "gray", reason: "Missing flight/gate data" };
  }

  const dep = new Date(flight.scheduledDep).getTime();
  const boardingClose = dep - 10 * 60 * 1000;
  const now = Date.now();
  const minsToClose = (boardingClose - now) / 60000;

  if (p.activity === "boarded") {
    return { ...p, etaMinutes: 0, status: "green", reason: "✅ Boarded" };
  }
  if (p.activity === "at_gate") {
    const s: PassengerStatus = minsToClose < 2 ? "yellow" : "green";
    return { ...p, etaMinutes: 0, status: s, reason: "✅ At gate" };
  }

  const dist = haversineMeters(p.location, gate.coordinate);
  const speedMps = p.needsWheelchair ? 0.80 : 1.20;
  const etaMin = dist / (speedMps * 60);
  const slack = minsToClose - etaMin;

  let status: PassengerStatus = "green";
  let reason = "On track";

  if (slack < -1) { status = "red"; reason = "⛔ Cannot make flight"; }
  else if (slack < 3) { status = "yellow"; reason = "⚠️ Tight connection"; }

  if (p.activity === "shopping") reason = status === "green" ? "🛍️ Shopping (time OK)" : "🛍️ Shopping (time tight!)";
  else if (p.activity === "dining") reason = status === "green" ? "🍜 Dining (time OK)" : "🍜 Dining (leave now!)";
  else if (p.activity === "idle") reason = status === "green" ? "💺 Resting" : "💺 Resting (move now!)";

  if (p.needsWheelchair) reason += " · ♿ Wheelchair";

  return { ...p, etaMinutes: Math.max(1, Math.round(etaMin)), status, reason };
}

export function computeGateStats(passengers: PassengerComputed[], gateId: string): GateStats {
  const ps = passengers.filter(p => p.gateId === gateId);
  return {
    total: ps.length,
    boarded: ps.filter(p => p.activity === "boarded").length,
    atGateWaiting: ps.filter(p => p.activity === "at_gate").length,
    enRoute: ps.filter(p => p.activity === "moving").length,
    notMoving: ps.filter(p => ["shopping", "dining", "idle"].includes(p.activity)).length,
  };
}

export function defaultSmsTemplate(p: PassengerComputed, gateName: string, flightId: string) {
  const urgency = p.transfer?.urgency === "urgent" ? " — URGENT" : "";
  const base = `Orienta: Your flight ${flightId} departs from Gate ${gateName}${urgency}.`;
  if (p.extStatus === "lost" || p.extStatus === "offline") {
    return `${base} We have lost your location. Please reply with your current position (e.g., "near E21 shopping area").`;
  }
  if (p.transfer?.urgency === "urgent" || p.status === "red" || p.status === "yellow") {
    return `${base} Please proceed IMMEDIATELY to your gate. Do not stop.`;
  }
  return `${base} Please make your way to the gate. Check-in closes in approx. ${p.etaMinutes ? p.etaMinutes + 10 : "?"} minutes.`;
}

export function agentReply(p: PassengerComputed, gateName: string, flightId: string, userMsg: string) {
  const premium = p.plan === "premium" ? " [Premium]" : "";
  const lc = userMsg.toLowerCase();

  if (/where|位置|在哪|where am|my location/.test(lc)) {
    return `${premium} Your real-time location is shown on your map. Head to Gate ${gateName} via Transfer Security (Level 2). ETA approx. ${p.etaMinutes ?? "?"} min.`;
  }
  if (/navigate|navigation|route|导航|路线|how do i get/.test(lc)) {
    return `${premium} Route to ${gateName}: ① Transfer Security checkpoint (Level 3) ② Take escalator to Level 2 ③ Follow E-gates signs to ${gateName}. ETA: ${p.etaMinutes ?? "?"} min.`;
  }
  if (/human|agent|staff|real person|人工|transfer|转人工/.test(lc)) {
    if (p.plan === "premium") {
      return `[Operator] Connecting you to a ground agent now. Please stay in place and show this screen to staff. Your gate is ${gateName}, flight ${flightId}.`;
    }
    return `I understand you need human assistance. Please proceed to the nearest Orienta service counter. Your flight is ${flightId} at Gate ${gateName}.`;
  }
  if (/security|安检|checkpoint/.test(lc)) {
    return `${premium} I→I Transfer: Go to Transfer Security on Level 3 first. No immigration needed. Then proceed to Gate ${gateName} on Level 2.`;
  }
  if (p.extStatus === "lost") {
    return `${premium} We've lost your GPS signal. Please tell us where you are (e.g., "near E21 duty free") so we can update your navigation to Gate ${gateName}.`;
  }
  return `${premium} I'm tracking your progress to Gate ${gateName} (Flight ${flightId}). ETA: ${p.etaMinutes ?? "?"} min. Type any question for assistance.`;
}
