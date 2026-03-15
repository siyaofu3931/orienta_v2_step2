/**
 * API routes for production server (Render).
 * Provides /api/flight/closest, /api/transfer, /api/airport, /api/gate
 * when Python backend is not available.
 */
import type { Request, Response } from "express";

// Static airport centers (PEK T3E, SFO)
const AIRPORT_CENTERS: Record<string, [number, number]> = {
  PEK: [40.0748162, 116.6061088],
  SFO: [37.6155, -122.3866],
  ZBAA: [40.0748162, 116.6061088],
  KSFO: [37.6155, -122.3866],
};

// Static gate coordinates (PEK T3E + SFO) - [lat, lng]
const GATE_COORDS: Record<string, Record<string, [number, number]>> = {
  PEK: {
    E01: [40.0698778, 116.6078785], E02: [40.0698778, 116.6078785],
    E03: [40.070704, 116.6077329], E04: [40.070704, 116.6077329],
    E05: [40.0716972, 116.6075757], E06: [40.0716972, 116.6075757],
    E07: [40.0725621, 116.6074109], E08: [40.0733074, 116.6073059],
    E09: [40.074181, 116.6071724], E10: [40.0751136, 116.6071221],
    E11: [40.0759157, 116.6072787], E12: [40.0766563, 116.6076803],
    E13: [40.0774799, 116.6084715], E14: [40.0779452, 116.6091795],
    E15: [40.0794489, 116.6100024], E16: [40.0791242, 116.6095203],
    E17: [40.0787616, 116.6088537], E18: [40.078402, 116.608191],
    E19: [40.07804, 116.6075435], E20: [40.0774733, 116.6044201],
    E21: [40.0776957, 116.6036565], E22: [40.0779409, 116.6029138],
    E23: [40.0781821, 116.6021727], E24: [40.0784103, 116.6014201],
    E25: [40.0775324, 116.6014014], E26: [40.077247, 116.6022891],
    E27: [40.0767272, 116.6034503], E28: [40.0761525, 116.6041812],
    E29: [40.0754611, 116.6047395], E30: [40.0745852, 116.6051611],
    E31: [40.0738661, 116.6052917], E32: [40.0729995, 116.6054142],
    E33: [40.0723848, 116.6055246], E34: [40.0718901, 116.6056069],
    E35: [40.0711442, 116.605722], E36: [40.0703919, 116.605822],
  },
  SFO: {
    G1: [37.6173605, -122.3895], G2: [37.6176476, -122.390253],
    G3: [37.6174329, -122.391098], G4: [37.6177357, -122.391818],
    G5: [37.6179453, -122.390962], G6: [37.6182478, -122.391683],
    G7: [37.6180321, -122.392527], G8: [37.6183349, -122.393248],
    G9: [37.618476, -122.392245], G10: [37.6187813, -122.392954],
    "G11-G12": [37.6185378, -122.3934748], "G13-G14": [37.618814, -122.393292],
    A1: [37.6139105, -122.388314], B3: [37.6138443, -122.3844905],
  },
};

function normalizeFlight(s: string): string {
  return (s || "").trim().toUpperCase().replace(/\s+/g, "");
}

async function fetchFlightAware(flightIdent: string): Promise<any> {
  const key = process.env.FLIGHTAWARE_API_KEY || process.env.VITE_FLIGHTAWARE_API_KEY || "";
  if (!key) throw new Error("FLIGHTAWARE_API_KEY not configured");

  const utc = new Date();
  const start = new Date(utc);
  start.setDate(start.getDate() - 2);
  const end = new Date(utc);
  end.setDate(end.getDate() + 2);

  const params = new URLSearchParams({
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    max_pages: "1",
  });

  const url = `https://aeroapi.flightaware.com/aeroapi/flights/${encodeURIComponent(flightIdent)}?${params}`;
  const res = await fetch(url, {
    headers: { "x-apikey": key, Accept: "application/json" },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FlightAware ${res.status}: ${err.slice(0, 200)}`);
  }

  const j = await res.json();
  const flights = j.flights || [];
  if (flights.length === 0) throw new Error(`No flights found for ${flightIdent}`);

  // Pick first flight (simplified)
  const f = flights[0];
  const origin = f.origin || {};
  const dest = f.destination || {};
  const depIata = origin.code_iata || origin.code || "—";
  const arrIata = dest.code_iata || dest.code || "—";

  const toLocal = (iso: string | undefined, tz: string | undefined): string => {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      return d.toLocaleString("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", "");
    } catch {
      return iso.slice(0, 16).replace("T", " ");
    }
  };

  return {
    flight_iata: f.operator_iata && f.flight_number ? `${f.operator_iata}${f.flight_number}` : flightIdent,
    dep_iata: depIata,
    arr_iata: arrIata,
    dep_time_local: toLocal(f.scheduled_out || f.scheduled_off, origin.timezone),
    arr_time_local: toLocal(f.scheduled_in || f.scheduled_on, dest.timezone),
    dep_terminal: f.terminal_origin || "—",
    dep_gate: f.gate_origin || "—",
    arr_terminal: f.terminal_destination || "—",
    arr_gate: f.gate_destination || "—",
    status: f.status || "Scheduled",
  };
}

function toInstanceDict(inst: any) {
  return {
    flight_iata: inst.flight_iata,
    dep_iata: inst.dep_iata,
    arr_iata: inst.arr_iata,
    dep_time_local: inst.dep_time_local,
    arr_time_local: inst.arr_time_local,
    dep_terminal: inst.dep_terminal,
    dep_gate: inst.dep_gate,
    arr_terminal: inst.arr_terminal,
    arr_gate: inst.arr_gate,
  };
}

export function registerApiRoutes(app: import("express").Application) {
  app.get("/api/config", (_req, res) => {
    res.json({ ok: false, data: null });
  });

  app.get("/api/mapkit/token", (_req, res) => {
    res.type("text/plain").send("");
  });

  app.get("/api/airport", (req, res) => {
    const airport = (req.query.airport as string || "").toUpperCase();
    if (!airport) return res.status(400).json({ ok: false, error: "missing_airport" });

    const center = AIRPORT_CENTERS[airport] || AIRPORT_CENTERS[airport.slice(0, 3)];
    if (!center) return res.status(404).json({ ok: false, error: "airport_not_found" });

    res.json({ ok: true, data: { airport, center } });
  });

  app.get("/api/gate", (req, res) => {
    const airport = (req.query.airport as string || "").toUpperCase();
    const gate = (req.query.gate as string || "").toUpperCase();
    if (!airport || !gate) return res.status(400).json({ ok: false, error: "missing_airport_or_gate" });

    const gates = GATE_COORDS[airport] || GATE_COORDS[airport.slice(0, 3)];
    if (!gates) return res.status(404).json({ ok: false, error: "airport_not_found" });

    const center = gates[gate] || gates[gate.replace("-", "-")];
    if (!center) {
      const centerAirport = AIRPORT_CENTERS[airport] || AIRPORT_CENTERS[airport.slice(0, 3)];
      if (centerAirport) return res.json({ ok: true, data: { center: centerAirport } });
      return res.status(404).json({ ok: false, error: "gate_not_found" });
    }

    res.json({ ok: true, data: { center } });
  });

  app.get("/api/flight/closest", async (req, res) => {
    const raw = (req.query.q as string || req.query.flight as string || "").trim();
    const flightIdent = normalizeFlight(raw);
    if (!flightIdent) return res.status(400).json({ ok: false, error: "missing_flight" });

    try {
      const inst = await fetchFlightAware(flightIdent);
      const badgeLabel = (inst.status || "").toUpperCase().trim() || "SCHEDULED";
      const badgeClass = /en route|depart|arriv|land/i.test(badgeLabel) ? "ok" : "neutral";

      res.json({
        ok: true,
        data: {
          query: raw,
          flight_ident: flightIdent,
          instance: toInstanceDict(inst),
          badge: { label: badgeLabel, class: badgeClass },
          updated: "now",
          provider: "FlightAware",
        },
      });
    } catch (e: any) {
      res.status(502).json({ ok: false, error: "provider_error", message: e?.message || String(e) });
    }
  });

  app.post("/api/transfer", async (req, res) => {
    const body = req.body || {};
    const arrRaw = body.arrFlight || body.arrivalFlight || body.arr || "";
    const depRaw = body.depFlight || body.departureFlight || body.dep || "";

    const arrIdent = normalizeFlight(String(arrRaw));
    const depIdent = normalizeFlight(String(depRaw));

    if (!arrIdent || !depIdent) return res.status(400).json({ ok: false, error: "missing_flights" });

    try {
      const [arrInst, depInst] = await Promise.all([fetchFlightAware(arrIdent), fetchFlightAware(depIdent)]);

      const hub = (arrInst.arr_iata || depInst.dep_iata || "").toUpperCase();
      const fromGate = arrInst.arr_gate || "—";
      const toGate = depInst.dep_gate || "—";

      let walkDistanceM: number | null = null;
      let walkTimeMin: number | null = null;

      const fromCenter = GATE_COORDS[hub]?.[fromGate] || GATE_COORDS[hub]?.[fromGate.replace("-", "-")];
      const toCenter = GATE_COORDS[hub]?.[toGate] || GATE_COORDS[hub]?.[toGate.replace("-", "-")];
      if (fromCenter && toCenter) {
        const R = 6371000;
        const dLat = (toCenter[0] - fromCenter[0]) * Math.PI / 180;
        const dLon = (toCenter[1] - fromCenter[1]) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(fromCenter[0] * Math.PI / 180) * Math.cos(toCenter[0] * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        walkDistanceM = Math.round(R * c * 1.35);
        walkTimeMin = Math.round(walkDistanceM / 1.25 / 60);
      }

      res.json({
        ok: true,
        data: {
          arrival: toInstanceDict(arrInst),
          departure: toInstanceDict(depInst),
          hub_airport: hub,
          from_gate: fromGate,
          to_gate: toGate,
          walk_distance_m: walkDistanceM,
          walk_time_min: walkTimeMin,
          provider: "FlightAware",
        },
      });
    } catch (e: any) {
      res.status(502).json({ ok: false, error: "provider_error", message: e?.message || String(e) });
    }
  });
}
