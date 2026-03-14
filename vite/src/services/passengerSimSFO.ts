import type { Flight, Gate, Passenger, LatLng, PaxPlan, PaxExtStatus } from "./types";
import { clamp, haversineMeters, makePolyline, randPick } from "./utils";

// ──────────────────────────────────────────────
// SFO Gate coordinates — source: OpenStreetMap Overpass API (Feb 2026)
// query: node[aeroway=gate](37.600,-122.420,37.640,-122.350)
// ──────────────────────────────────────────────
export const SFO_CENTER: LatLng = { lat: 37.6155, lng: -122.3866 };

const SFO_GATE_COORDS: Record<string, LatLng> = {
  // Terminal A (International)
  "A1":  { lat: 37.6139105, lng: -122.388314 },
  "A2":  { lat: 37.613345,  lng: -122.388689 },
  "A3":  { lat: 37.6138967, lng: -122.389051 },
  "A4":  { lat: 37.6133353, lng: -122.389423 },
  "A5":  { lat: 37.613297,  lng: -122.389449 },
  "A6":  { lat: 37.6126511, lng: -122.3891497 },
  "A7":  { lat: 37.6126175, lng: -122.3891717 },
  "A8":  { lat: 37.6120777, lng: -122.3895301 },
  "A9":  { lat: 37.612891,  lng: -122.3897184 },
  "A10": { lat: 37.6123205, lng: -122.3900962 },
  "A11": { lat: 37.6115083, lng: -122.389907 },
  "A12": { lat: 37.6117474, lng: -122.3904762 },
  "A13": { lat: 37.6114751, lng: -122.389961 },
  "A14": { lat: 37.6114954, lng: -122.3900098 },
  "A15": { lat: 37.6116737, lng: -122.390432 },
  // Terminal B (Domestic/United)
  "B1":  { lat: 37.6142595, lng: -122.387189 },
  "B2":  { lat: 37.6141152, lng: -122.3867838 },
  "B3":  { lat: 37.6138443, lng: -122.3844905 },
  "B4":  { lat: 37.6138146, lng: -122.3858342 },
  "B5":  { lat: 37.6137536, lng: -122.3855861 },
  "B6":  { lat: 37.6133097, lng: -122.3842839 },
  "B7":  { lat: 37.6132188, lng: -122.3842482 },
  "B8":  { lat: 37.6131016, lng: -122.3842026 },
  "B9":  { lat: 37.6126624, lng: -122.3844362 },
  "B10": { lat: 37.612686,  lng: -122.3853426 },
  "B11": { lat: 37.6126574, lng: -122.3852734 },
  "B12": { lat: 37.6123327, lng: -122.3846534 },
  "B13": { lat: 37.6119697, lng: -122.3848928 },
  "B14": { lat: 37.6116407, lng: -122.3851137 },
  "B15": { lat: 37.6119298, lng: -122.3858655 },
  "B16": { lat: 37.61189,   lng: -122.3857692 },
  "B17": { lat: 37.6112994, lng: -122.3853356 },
  "B18": { lat: 37.6109898, lng: -122.385538 },
  "B19": { lat: 37.6112011, lng: -122.3861094 },
  "B20": { lat: 37.6111525, lng: -122.3861415 },
  "B21": { lat: 37.6106442, lng: -122.3857662 },
  "B22": { lat: 37.6104637, lng: -122.3859687 },
  "B23": { lat: 37.610541,  lng: -122.3861554 },
  "B24": { lat: 37.6105618, lng: -122.3862059 },
  "B25": { lat: 37.6106399, lng: -122.3863946 },
  "B26": { lat: 37.6108309, lng: -122.386353 },
  "B27": { lat: 37.6108663, lng: -122.3863296 },
  // Terminal C
  "C1":  { lat: 37.6143662, lng: -122.3844282 },
  "C2":  { lat: 37.6151137, lng: -122.3836368 },
  "C3":  { lat: 37.6154258, lng: -122.3834354 },
  "C4":  { lat: 37.614918,  lng: -122.3831621 },
  "C5":  { lat: 37.6152241, lng: -122.3829604 },
  "C6":  { lat: 37.6147424, lng: -122.382744 },
  "C7":  { lat: 37.6149848, lng: -122.3824714 },
  "C8":  { lat: 37.6146456, lng: -122.3825244 },
  "C9":  { lat: 37.6149534, lng: -122.3823151 },
  "C10": { lat: 37.6146266, lng: -122.3822612 },
  "C11": { lat: 37.6147998, lng: -122.3821517 },
  // Terminal D
  "D1":  { lat: 37.616984,  lng: -122.3824875 },
  "D3":  { lat: 37.6170847, lng: -122.3816809 },
  "D4":  { lat: 37.6169608, lng: -122.3813831 },
  "D5":  { lat: 37.6168198, lng: -122.3810409 },
  "D6":  { lat: 37.616845,  lng: -122.3809902 },
  "D7":  { lat: 37.6170606, lng: -122.3808478 },
  "D8":  { lat: 37.6174275, lng: -122.3809236 },
  "D9":  { lat: 37.6175704, lng: -122.381054 },
  "D10": { lat: 37.6179179, lng: -122.3810883 },
  "D11": { lat: 37.6181624, lng: -122.3812575 },
  "D12": { lat: 37.6182643, lng: -122.3814952 },
  "D14": { lat: 37.6181645, lng: -122.3816964 },
  "D15": { lat: 37.6179305, lng: -122.3818448 },
  "D16": { lat: 37.6176549, lng: -122.3819234 },
  // Terminal E (International)
  "E2":  { lat: 37.6186927, lng: -122.3860034 },
  "E3":  { lat: 37.618592,  lng: -122.385449 },
  "E4":  { lat: 37.6181607, lng: -122.3847474 },
  "E5":  { lat: 37.6184855, lng: -122.3844676 },
  "E6":  { lat: 37.6187948, lng: -122.3848896 },
  "E7":  { lat: 37.6188612, lng: -122.3841941 },
  "E8":  { lat: 37.61922,   lng: -122.3845289 },
  "E9":  { lat: 37.6191222, lng: -122.3839579 },
  "E10": { lat: 37.6194657, lng: -122.3844449 },
  "E11": { lat: 37.6193959, lng: -122.383884 },
  "E12": { lat: 37.619561,  lng: -122.3842754 },
  "E13": { lat: 37.6194536, lng: -122.3840393 },
  // Terminal F (International)
  "F5":  { lat: 37.6199654, lng: -122.3871133 },
  "F6":  { lat: 37.6203285, lng: -122.3871137 },
  "F7":  { lat: 37.6205623, lng: -122.3869537 },
  "F8":  { lat: 37.6206985, lng: -122.3868604 },
  "F9":  { lat: 37.6207473, lng: -122.3870803 },
  "F10": { lat: 37.6208193, lng: -122.3867823 },
  "F11": { lat: 37.6202588, lng: -122.3878267 },
  "F12": { lat: 37.6200532, lng: -122.3882767 },
  "F13": { lat: 37.6205535, lng: -122.3885186 },
  "F14": { lat: 37.6202912, lng: -122.3888444 },
  "F15": { lat: 37.6208347, lng: -122.3891944 },
  "F16": { lat: 37.6205238, lng: -122.3893994 },
  "F17": { lat: 37.6207622, lng: -122.3899683 },
  "F18": { lat: 37.6207801, lng: -122.3900107 },
  "F19": { lat: 37.6209417, lng: -122.3903166 },
  "F20": { lat: 37.6210921, lng: -122.3902859 },
  "F21": { lat: 37.6211911, lng: -122.3901757 },
  "F22": { lat: 37.6211502, lng: -122.3898735 },
  // Terminal G (Domestic)
  "G1":  { lat: 37.6173605, lng: -122.3895 },
  "G2":  { lat: 37.6176476, lng: -122.390253 },
  "G3":  { lat: 37.6174329, lng: -122.391098 },
  "G4":  { lat: 37.6177357, lng: -122.391818 },
  "G5":  { lat: 37.6179453, lng: -122.390962 },
  "G6":  { lat: 37.6182478, lng: -122.391683 },
  "G7":  { lat: 37.6180321, lng: -122.392527 },
  "G8":  { lat: 37.6183349, lng: -122.393248 },
  "G9":  { lat: 37.618476,  lng: -122.392245 },
  "G10": { lat: 37.6187813, lng: -122.392954 },
  "G11-G12": { lat: 37.6185378, lng: -122.3934748 },
  "G13-G14": { lat: 37.618814,  lng: -122.393292 },
};

// SFO amenity areas for simulation
const SFO_AMENITIES: LatLng[] = [
  { lat: 37.6135, lng: -122.3868 }, // Terminal B central
  { lat: 37.6148, lng: -122.3856 }, // B/C connector
  { lat: 37.6155, lng: -122.3845 }, // Terminal C
  { lat: 37.6170, lng: -122.3832 }, // Terminal D area
  { lat: 37.6190, lng: -122.3858 }, // Terminal E
  { lat: 37.6205, lng: -122.3880 }, // Terminal F
  { lat: 37.6178, lng: -122.3912 }, // Terminal G
  { lat: 37.6128, lng: -122.3870 }, // Terminal A
];

const SFO_BBOX = {
  minLat: 37.609, maxLat: 37.622,
  minLng: -122.394, maxLng: -122.380,
};

function clampToSFO(p: LatLng): LatLng {
  return {
    lat: clamp(p.lat, SFO_BBOX.minLat, SFO_BBOX.maxLat),
    lng: clamp(p.lng, SFO_BBOX.minLng, SFO_BBOX.maxLng),
  };
}

function randomNearby(p: LatLng, radiusM: number): LatLng {
  const dlat = (Math.random() - 0.5) * 2 * radiusM / 111320;
  const dlng = (Math.random() - 0.5) * 2 * radiusM / (111320 * Math.cos(p.lat * Math.PI / 180));
  return { lat: p.lat + dlat, lng: p.lng + dlng };
}

export function buildSFOGates(): Gate[] {
  return Object.entries(SFO_GATE_COORDS).map(([id, coord]) => ({
    id, name: id, coordinate: coord,
  }));
}

// SFO Intl→Domestic flights
const SFO_INTL_FLIGHTS = [
  { id: "B6133",  callsign: "B6 133",  from: "JFK", arr: 0,  gate: "B3" },
  { id: "UA388",  callsign: "UA 388",  from: "NRT", arr: 10, gate: "F12" },
  { id: "CX872",  callsign: "CX 872",  from: "HKG", arr: 20, gate: "F7" },
  { id: "LH456",  callsign: "LH 456",  from: "FRA", arr: 5,  gate: "A8" },
  { id: "AA202",  callsign: "AA 202",  from: "LAX", arr: 15, gate: "B15" },
  { id: "DL1002", callsign: "DL 1002", from: "ATL", arr: 30, gate: "B22" },
  { id: "QF74",   callsign: "QF 74",   from: "SYD", arr: 8,  gate: "F18" },
  { id: "SQ1",    callsign: "SQ 1",    from: "SIN", arr: 12, gate: "F5" },
];

const SFO_DOM_FLIGHTS = [
  { id: "CA986",  callsign: "CA 986",  to: "PEK",  dep: 90,  gate: "G13-G14" },
  { id: "UA235",  callsign: "UA 235",  to: "ORD",  dep: 60,  gate: "G5" },
  { id: "AA302",  callsign: "AA 302",  to: "DFW",  dep: 45,  gate: "G3" },
  { id: "DL504",  callsign: "DL 504",  to: "JFK",  dep: 75,  gate: "G7" },
  { id: "WN400",  callsign: "WN 400",  to: "LAS",  dep: 30,  gate: "D5" },
  { id: "AS712",  callsign: "AS 712",  to: "SEA",  dep: 55,  gate: "D10" },
  { id: "B6244",  callsign: "B6 244",  to: "BOS",  dep: 80,  gate: "C6" },
  { id: "NK332",  callsign: "NK 332",  to: "LAX",  dep: 25,  gate: "C10" },
  { id: "F9900",  callsign: "F9 900",  to: "DEN",  dep: 40,  gate: "B12" },
  { id: "G4511",  callsign: "G4 511",  to: "PHX",  dep: 35,  gate: "D8" },
];

function offsetMs(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

// SFO passenger profiles — 30 total, TX1 = SIYAO FU (初始离线)
const SFO_PROFILES = [
  // Premium
  { id: "TX1",  name: "Siyao Fu",         nat: "CN", locale: "zh-CN", plan: "premium" as PaxPlan, wheelchair: false, initOffline: true  },
  { id: "TX2",  name: "David Kim",         nat: "KR", locale: "ko-KR", plan: "premium" as PaxPlan, wheelchair: false, initOffline: false },
  { id: "SP1",  name: "Emma Reynolds",     nat: "GB", locale: "en-GB", plan: "premium" as PaxPlan, wheelchair: false, initOffline: false },
  { id: "SP2",  name: "Marco Ricci",       nat: "IT", locale: "it-IT", plan: "premium" as PaxPlan, wheelchair: true,  initOffline: false },
  { id: "SP3",  name: "Yuki Tanaka",       nat: "JP", locale: "ja-JP", plan: "premium" as PaxPlan, wheelchair: false, initOffline: false },
  { id: "SP4",  name: "Priya Nair",        nat: "IN", locale: "en-IN", plan: "premium" as PaxPlan, wheelchair: false, initOffline: false },
  // Free
  { id: "FP1",  name: "Lucas Martin",      nat: "FR", locale: "fr-FR", plan: "free" as PaxPlan,    wheelchair: false, initOffline: false },
  { id: "FP2",  name: "Aisha Hassan",      nat: "EG", locale: "ar-EG", plan: "free" as PaxPlan,    wheelchair: false, initOffline: false },
  { id: "FP3",  name: "Carlos Vega",       nat: "MX", locale: "es-MX", plan: "free" as PaxPlan,    wheelchair: false, initOffline: true  },
  { id: "FP4",  name: "Sophie Dubois",     nat: "FR", locale: "fr-FR", plan: "free" as PaxPlan,    wheelchair: false, initOffline: false },
  { id: "FP5",  name: "Ivan Petrov",       nat: "RU", locale: "ru-RU", plan: "free" as PaxPlan,    wheelchair: false, initOffline: false },
  { id: "FP6",  name: "Min-ji Lee",        nat: "KR", locale: "ko-KR", plan: "free" as PaxPlan,    wheelchair: false, initOffline: true  },
  { id: "FP7",  name: "Ahmed Al-Sayed",    nat: "SA", locale: "ar-SA", plan: "free" as PaxPlan,    wheelchair: false, initOffline: false },
  { id: "FP8",  name: "Zara Williams",     nat: "AU", locale: "en-AU", plan: "free" as PaxPlan,    wheelchair: true,  initOffline: false },
  { id: "FP9",  name: "Henrik Larsen",     nat: "DK", locale: "da-DK", plan: "free" as PaxPlan,    wheelchair: false, initOffline: false },
  { id: "FP10", name: "Ana Silva",         nat: "BR", locale: "pt-BR", plan: "free" as PaxPlan,    wheelchair: false, initOffline: false },
  { id: "FP11", name: "Thomas Weber",      nat: "DE", locale: "de-DE", plan: "free" as PaxPlan,    wheelchair: false, initOffline: false },
  { id: "FP12", name: "Sara Johansson",    nat: "SE", locale: "sv-SE", plan: "free" as PaxPlan,    wheelchair: false, initOffline: false },
  { id: "FP13", name: "Ravi Krishnan",     nat: "IN", locale: "hi-IN", plan: "free" as PaxPlan,    wheelchair: false, initOffline: true  },
  { id: "FP14", name: "Maria González",    nat: "ES", locale: "es-ES", plan: "free" as PaxPlan,    wheelchair: false, initOffline: false },
  { id: "FP15", name: "Jean-Paul Blanc",   nat: "FR", locale: "fr-FR", plan: "free" as PaxPlan,    wheelchair: false, initOffline: false },
  { id: "FP16", name: "Fatima Al-Rashid",  nat: "AE", locale: "ar-AE", plan: "free" as PaxPlan,    wheelchair: true,  initOffline: false },
  { id: "FP17", name: "Lars Andersen",     nat: "NO", locale: "no-NO", plan: "free" as PaxPlan,    wheelchair: false, initOffline: false },
  { id: "FP18", name: "Julia Schmidt",     nat: "DE", locale: "de-DE", plan: "free" as PaxPlan,    wheelchair: false, initOffline: false },
  { id: "FP19", name: "Omar Al-Said",      nat: "AE", locale: "ar-AE", plan: "free" as PaxPlan,    wheelchair: false, initOffline: false },
  { id: "FP20", name: "Elena Volkov",      nat: "RU", locale: "ru-RU", plan: "free" as PaxPlan,    wheelchair: false, initOffline: false },
  { id: "FP21", name: "Kevin O'Brien",     nat: "IE", locale: "en-IE", plan: "free" as PaxPlan,    wheelchair: false, initOffline: false },
  { id: "FP22", name: "Sakura Yamamoto",   nat: "JP", locale: "ja-JP", plan: "free" as PaxPlan,    wheelchair: false, initOffline: false },
  { id: "FP23", name: "Pierre Moreau",     nat: "FR", locale: "fr-FR", plan: "free" as PaxPlan,    wheelchair: false, initOffline: false },
  { id: "FP24", name: "Ling Wei",          nat: "CN", locale: "zh-CN", plan: "free" as PaxPlan,    wheelchair: false, initOffline: false },
];

// Scenario assignment per passenger
const SFO_SCENARIOS: Record<string, { extStatus: PaxExtStatus; activity: string; inboundIdx: number; outboundIdx: number; note: string }> = {
  "TX1":  { extStatus: "offline", activity: "idle",     inboundIdx: 0, outboundIdx: 0, note: "SIYAO FU — Transfer B6 133 (B3) → CA 986 (G13)" },
  "TX2":  { extStatus: "yellow",  activity: "moving",   inboundIdx: 1, outboundIdx: 1, note: "Moving to gate G5 — tight connection" },
  "SP1":  { extStatus: "green",   activity: "moving",   inboundIdx: 2, outboundIdx: 2, note: "On track to C6" },
  "SP2":  { extStatus: "green",   activity: "at_gate",  inboundIdx: 3, outboundIdx: 3, note: "♿ At gate G3 with assistance" },
  "SP3":  { extStatus: "green",   activity: "moving",   inboundIdx: 4, outboundIdx: 4, note: "Moving to F18" },
  "SP4":  { extStatus: "red",     activity: "shopping", inboundIdx: 5, outboundIdx: 5, note: "At Duty Free — final call DL504" },
  "FP1":  { extStatus: "green",   activity: "moving",   inboundIdx: 6, outboundIdx: 6, note: "Moving to G7" },
  "FP2":  { extStatus: "yellow",  activity: "dining",   inboundIdx: 7, outboundIdx: 7, note: "Dining — tight window" },
  "FP3":  { extStatus: "offline", activity: "idle",     inboundIdx: 0, outboundIdx: 8, note: "No network — European SIM" },
  "FP4":  { extStatus: "green",   activity: "at_gate",  inboundIdx: 1, outboundIdx: 9, note: "At gate D10 waiting" },
  "FP5":  { extStatus: "lost",    activity: "idle",     inboundIdx: 2, outboundIdx: 0, note: "Location lost in B terminal" },
  "FP6":  { extStatus: "offline", activity: "idle",     inboundIdx: 3, outboundIdx: 1, note: "Korean SIM offline" },
  "FP7":  { extStatus: "green",   activity: "moving",   inboundIdx: 4, outboundIdx: 2, note: "Moving to AA302 gate" },
  "FP8":  { extStatus: "green",   activity: "moving",   inboundIdx: 5, outboundIdx: 3, note: "♿ Moving with assistance" },
  "FP9":  { extStatus: "missed",  activity: "idle",     inboundIdx: 6, outboundIdx: 4, note: "Flight WN400 already departed" },
  "FP10": { extStatus: "green",   activity: "moving",   inboundIdx: 7, outboundIdx: 5, note: "Moving to AS712 gate" },
  "FP11": { extStatus: "yellow",  activity: "idle",     inboundIdx: 0, outboundIdx: 6, note: "Resting near B terminal" },
  "FP12": { extStatus: "green",   activity: "at_gate",  inboundIdx: 1, outboundIdx: 7, note: "At gate D8 early" },
  "FP13": { extStatus: "offline", activity: "idle",     inboundIdx: 2, outboundIdx: 8, note: "Data roaming disabled" },
  "FP14": { extStatus: "green",   activity: "moving",   inboundIdx: 3, outboundIdx: 9, note: "Moving to NK332 gate" },
  "FP15": { extStatus: "yellow",  activity: "shopping", inboundIdx: 4, outboundIdx: 0, note: "Shopping in Terminal B" },
  "FP16": { extStatus: "green",   activity: "moving",   inboundIdx: 5, outboundIdx: 1, note: "♿ Moving to F9900 gate" },
  "FP17": { extStatus: "lost",    activity: "idle",     inboundIdx: 6, outboundIdx: 2, note: "Location lost in G terminal" },
  "FP18": { extStatus: "green",   activity: "moving",   inboundIdx: 7, outboundIdx: 3, note: "Moving to G4511 gate" },
  "FP19": { extStatus: "red",     activity: "dining",   inboundIdx: 0, outboundIdx: 4, note: "Still dining — final call" },
  "FP20": { extStatus: "offline", activity: "idle",     inboundIdx: 1, outboundIdx: 5, note: "Russian SIM offline" },
  "FP21": { extStatus: "missed",  activity: "idle",     inboundIdx: 2, outboundIdx: 6, note: "Flight UA235 missed" },
  "FP22": { extStatus: "green",   activity: "at_gate",  inboundIdx: 3, outboundIdx: 7, note: "At gate B12 boarded" },
  "FP23": { extStatus: "yellow",  activity: "moving",   inboundIdx: 4, outboundIdx: 8, note: "Slow progress — tight" },
  "FP24": { extStatus: "green",   activity: "moving",   inboundIdx: 5, outboundIdx: 9, note: "On track to G10 area" },
};

export function buildSFOFlights(): Flight[] {
  const now = Date.now();
  const all: Flight[] = [];
  for (const f of SFO_INTL_FLIGHTS) {
    all.push({
      id: f.id, callsign: f.callsign, destination: f.from,
      scheduledDep: new Date(now + f.arr * 60_000).toISOString(),
      status: "Gate Open", gateRef: f.gate, gateId: f.gate,
    });
  }
  for (const f of SFO_DOM_FLIGHTS) {
    all.push({
      id: f.id, callsign: f.callsign, destination: f.to,
      scheduledDep: new Date(now + f.dep * 60_000).toISOString(),
      status: f.dep < 30 ? "Final Call" : f.dep < 60 ? "Boarding" : "Gate Open",
      gateRef: f.gate, gateId: f.gate,
    });
  }
  return all;
}

export function buildSFOWorld(gates: Gate[], flights: Flight[]): { passengers: Passenger[] } {
  const gatesById = new Map(gates.map(g => [g.id, g]));
  const flightsById = new Map(flights.map(f => [f.id, f]));
  const inboundList = SFO_INTL_FLIGHTS;
  const outboundList = SFO_DOM_FLIGHTS;
  const now = Date.now();
  const passengers: Passenger[] = [];

  for (const profile of SFO_PROFILES) {
    const scenario = SFO_SCENARIOS[profile.id];
    if (!scenario) continue;

    const inFlight = inboundList[scenario.inboundIdx % inboundList.length];
    const outFlight = outboundList[scenario.outboundIdx % outboundList.length];

    const outGateKey = outFlight.gate.replace("-", "-"); // keep as-is
    const gateCoord = SFO_GATE_COORDS[outGateKey] || SFO_CENTER;

    let location: LatLng;
    let path: LatLng[] | undefined;
    let pathIndex: number | undefined;

    if (scenario.activity === "moving") {
      const start = clampToSFO(randomNearby(randPick(SFO_AMENITIES), 80));
      location = start;
      path = makePolyline(start, gateCoord, 10);
      pathIndex = 0;
    } else if (scenario.activity === "at_gate" || scenario.activity === "boarded") {
      location = clampToSFO(randomNearby(gateCoord, 15));
    } else {
      location = clampToSFO(randomNearby(randPick(SFO_AMENITIES), 60));
    }

    const urgency = (scenario.extStatus === "red" || outFlight.dep < 40) ? "urgent" : "normal";

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
        inboundFlight: inFlight.callsign,
        inboundFrom: inFlight.from,
        inboundArr: offsetMs(-inFlight.arr),
        outboundFlight: outFlight.callsign,
        outboundTo: outFlight.to,
        outboundDep: offsetMs(outFlight.dep),
        note: scenario.note,
      },
      flightId: outFlight.id,
      gateId: outGateKey,
      activity: scenario.activity as any,
      extStatus: scenario.extStatus,
      location: location!,
      path,
      pathIndex,
      lastUpdateMs: now,
    });
  }

  return { passengers };
}

export function stepSFOWorld(
  world: { passengers: Passenger[] },
  gatesById: Map<string, Gate>,
  dtMs: number
): { passengers: Passenger[] } {
  const next = world.passengers.map(p => {
    if (["missed", "offline", "lost"].includes(p.extStatus)) return p;
    if (p.activity === "boarded" || p.activity === "at_gate") return p;
    if (p.activity !== "moving" || !p.path || p.pathIndex == null) return p;

    const speedMps = p.needsWheelchair ? 0.75 : 1.15;
    let idx = p.pathIndex;
    let loc = p.location;
    let remainingDt = dtMs;

    while (remainingDt > 0 && idx < p.path.length - 1) {
      const a = p.path[idx];
      const b = p.path[idx + 1];
      const seg = haversineMeters(a, b);
      const segTime = (seg / speedMps) * 1000;
      if (remainingDt >= segTime) {
        idx += 1; loc = b; remainingDt -= segTime;
      } else {
        const t = clamp(remainingDt / segTime, 0, 1);
        loc = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
        remainingDt = 0;
      }
    }

    const gate = gatesById.get(p.gateId);
    if (gate && haversineMeters(loc, gate.coordinate) < 15) {
      return { ...p, location: gate.coordinate, activity: "at_gate" as const, extStatus: "green" as const, path: undefined, pathIndex: undefined, lastUpdateMs: Date.now() };
    }

    return { ...p, location: clampToSFO(loc), pathIndex: idx, lastUpdateMs: Date.now() };
  });
  return { passengers: next };
}

// Flight lookup for user input (B6 133 → gate B3, CA 986 → gate G13)
export const SFO_FLIGHT_GATE_MAP: Record<string, string> = {
  // Inbound
  "B6133": "B3", "B6 133": "B3",
  "UA388": "F12", "UA 388": "F12",
  "CX872": "F7", "CX 872": "F7",
  "LH456": "A8", "LH 456": "A8",
  "AA202": "B15", "AA 202": "B15",
  "DL1002": "B22", "DL 1002": "B22",
  "QF74": "F18", "QF 74": "F18",
  "SQ1": "F5", "SQ 1": "F5",
  // Outbound
  "CA986": "G13-G14", "CA 986": "G13-G14",
  "UA235": "G5", "UA 235": "G5",
  "AA302": "G3", "AA 302": "G3",
  "DL504": "G7", "DL 504": "G7",
  "WN400": "D5", "WN 400": "D5",
  "AS712": "D10", "AS 712": "D10",
  "B6244": "C6", "B6 244": "C6",
  "NK332": "C10", "NK 332": "C10",
  "F9900": "B12", "F9 900": "B12",
  "G4511": "D8", "G4 511": "D8",
};

export function lookupFlightGate(flightNum: string): string | null {
  const normalized = flightNum.trim().toUpperCase().replace(/\s+/g, "");
  // Try exact
  for (const [k, v] of Object.entries(SFO_FLIGHT_GATE_MAP)) {
    if (k.replace(/\s+/g, "").toUpperCase() === normalized) return v;
  }
  return null;
}

export function getGateCoord(gateId: string): LatLng | null {
  return SFO_GATE_COORDS[gateId] || null;
}
