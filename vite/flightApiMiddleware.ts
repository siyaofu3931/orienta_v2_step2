/**
 * Dev-only middleware: handle /api/flight/closest when backend (port 8000) is not running.
 * Calls FlightAware AeroAPI v4 so the pax flight page works without a separate backend.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const AEROAPI_BASE = "https://aeroapi.flightaware.com/aeroapi";

function getApiKey(): string | undefined {
  return (
    process.env.FLIGHTAWARE_API_KEY ||
    process.env.VITE_FLIGHTAWARE_API_KEY
  );
}

function sendJson(res: ServerResponse, status: number, body: object) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

/** Format ISO (UTC) time in airport local timezone for display */
function formatTime(iso: string | null | undefined, timeZone?: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const opts: Intl.DateTimeFormatOptions = {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    };
    if (timeZone) opts.timeZone = timeZone;
    return d.toLocaleTimeString("en-US", opts);
  } catch {
    return "—";
  }
}

/** Convert IATA flight ident to ICAO for AeroAPI (e.g. UA889 → UAL889). FlightAware uses ICAO. */
function toIcaoIdent(ident: string): string {
  const u = ident.toUpperCase().trim();
  const match = u.match(/^([A-Z0-9]{2})(\d+[A-Z]*)$/);
  if (!match) return u;
  const [, code, num] = match;
  const iataToIcao: Record<string, string> = {
    UA: "UAL", AA: "AAL", DL: "DAL", CA: "CCA", LH: "DLH", BA: "BAW",
    AF: "AFR", EK: "UAE", SQ: "SIA", CX: "CPA", NH: "ANA", JL: "JAL",
  };
  const icao = iataToIcao[code] || code;
  return icao + num;
}

/** Map AeroAPI flight object to our instance shape. Uses only API fields; no mock/hardcode. */
function flightToInstance(f: Record<string, unknown>, fallbackIdent: string): Record<string, string> {
  const origin = f.origin as Record<string, unknown> | undefined;
  const dest = f.destination as Record<string, unknown> | undefined;
  const depIata = (origin?.code_iata as string) || (origin?.code as string) || "—";
  const arrIata = (dest?.code_iata as string) || (dest?.code as string) || "—";
  const depTz = (origin?.timezone as string) || null;
  const arrTz = (dest?.timezone as string) || null;
  // API may use snake_case or camelCase
  const depGate = (f.gate_origin ?? f.gateOrigin ?? f.departure_gate) as string | undefined;
  const arrGate = (f.gate_destination ?? f.gateDestination ?? f.arrival_gate) as string | undefined;
  const depTerm = (f.terminal_origin ?? f.terminalOrigin ?? f.departure_terminal) as string | undefined;
  const arrTerm = (f.terminal_destination ?? f.terminalDestination ?? f.arrival_terminal) as string | undefined;
  const depTime =
    (f.actual_off ?? f.actual_out ?? f.actualOut ?? f.scheduled_off ?? f.scheduled_out ?? f.scheduledOut ?? f.estimated_off ?? f.estimated_out) as string | undefined;
  const arrTime =
    (f.actual_on ?? f.actual_in ?? f.actualIn ?? f.scheduled_on ?? f.scheduled_in ?? f.scheduledIn ?? f.estimated_on ?? f.estimated_in) as string | undefined;
  return {
    flight_iata: (f.ident_iata as string) || (f.ident as string) || fallbackIdent,
    dep_iata: depIata,
    arr_iata: arrIata,
    // AeroAPI often returns null for gate_origin/gate_destination; we show "—" when null (no mock)
    dep_gate: typeof depGate === "string" && depGate.trim() ? depGate.trim() : "—",
    arr_gate: typeof arrGate === "string" && arrGate.trim() ? arrGate.trim() : "—",
    dep_terminal: typeof depTerm === "string" && depTerm.trim() ? depTerm.trim() : "—",
    arr_terminal: typeof arrTerm === "string" && arrTerm.trim() ? arrTerm.trim() : "—",
    dep_time_local: formatTime(depTime, depTz),
    arr_time_local: formatTime(arrTime, arrTz),
  };
}

/** [lat, lon] for map center when backend /api/airport and /api/gate are not available */
const MOCK_AIRPORT_CENTERS: Record<string, [number, number]> = {
  ORD: [41.9742, -87.9073],   // Chicago O'Hare
  PEK: [40.0799, 116.6031],   // Beijing Capital
  SFO: [37.6213, -122.3790],  // San Francisco
  JFK: [40.6413, -73.7781],   // New York JFK
  XXX: [39.9042, 116.4074],   // fallback near Beijing
};

function handleMockAirport(url: URL, res: ServerResponse): boolean {
  if (url.pathname !== "/api/airport") return false;
  const airport = (url.searchParams.get("airport") || "").toUpperCase().trim() || "XXX";
  const center = MOCK_AIRPORT_CENTERS[airport] ?? MOCK_AIRPORT_CENTERS.XXX;
  sendJson(res, 200, { ok: true, data: { center } });
  return true;
}

function handleMockGate(url: URL, res: ServerResponse): boolean {
  if (url.pathname !== "/api/gate") return false;
  const airport = (url.searchParams.get("airport") || "").toUpperCase().trim() || "XXX";
  const center = MOCK_AIRPORT_CENTERS[airport] ?? MOCK_AIRPORT_CENTERS.XXX;
  sendJson(res, 200, { ok: true, data: { center } });
  return true;
}

/** Mock /api/config so the page doesn't 500 when backend is down. */
function handleMockConfig(url: URL, res: ServerResponse): boolean {
  if (url.pathname !== "/api/config") return false;
  const appleMapsId = process.env.VITE_MAPKIT_MAPS_ID || process.env.APPLE_MAPS_ID || undefined;
  sendJson(res, 200, { ok: true, data: appleMapsId ? { apple_maps_id: appleMapsId } : {} });
  return true;
}

/** Generate MapKit JS JWT when credentials exist in env; otherwise return "" so page falls back to OSM. */
async function getMapkitToken(req: IncomingMessage): Promise<string> {
  const teamId = process.env.VITE_MAPKIT_TEAM_ID || process.env.APPLE_TEAM_ID;
  const keyId = process.env.VITE_MAPKIT_KEY_ID || process.env.APPLE_KEY_ID;
  let privateKeyPem = process.env.VITE_MAPKIT_PRIVATE_KEY;
  const keyPath = process.env.VITE_MAPKIT_PRIVATE_KEY_PATH;
  if (!privateKeyPem && keyPath) {
    try {
      privateKeyPem = readFileSync(resolve(process.cwd(), keyPath), "utf8");
    } catch {
      return "";
    }
  }
  if (!teamId || !keyId || !privateKeyPem) return "";

  const host = req.headers.host || "localhost:5174";
  const origin = process.env.VITE_MAPKIT_ORIGIN || `http://${host}`;

  try {
    const { SignJWT, importPKCS8 } = await import("jose");
    const key = await importPKCS8(privateKeyPem.replace(/\\n/g, "\n"), "ES256");
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 60 * 60 * 24; // 24h
    const jwt = await new SignJWT({ origin })
      .setProtectedHeader({ alg: "ES256", kid: keyId })
      .setIssuer(teamId)
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .sign(key);
    return jwt;
  } catch {
    return "";
  }
}

export function createFlightApiMiddleware() {
  const apiKey = getApiKey();

  return async function flightApiMiddleware(
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void
  ): Promise<void> {
    if (req.method !== "GET") {
      next();
      return;
    }
    const url = new URL(req.url || "/", "http://localhost");
    if (handleMockConfig(url, res)) return;
    if (url.pathname === "/api/mapkit/token") {
      const token = await getMapkitToken(req);
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(token);
      return;
    }
    // Mock /api/airport and /api/gate so the map shows when backend (8000) is down
    if (handleMockAirport(url, res) || handleMockGate(url, res)) return;
    if (url.pathname !== "/api/flight/closest") {
      next();
      return;
    }
    const q = url.searchParams.get("q")?.trim();
    if (!q) {
      sendJson(res, 400, {
        ok: false,
        message: "Missing query parameter q (flight number).",
      });
      return;
    }
    if (!apiKey) {
      sendJson(res, 503, {
        ok: false,
        message:
          "FlightAware API key not set. Copy vite/.env.example to vite/.env and set FLIGHTAWARE_API_KEY (or VITE_FLIGHTAWARE_API_KEY), then restart the dev server.",
      });
      return;
    }
    try {
      const headers = { "x-apikey": apiKey };
      const rawIdent = q.trim();
      const icaoIdent = toIcaoIdent(rawIdent);
      // 1) GET /flights/{ident} — returns ~14 days of recent + scheduled with times, gates, terminals (no mock)
      const identsToTry = rawIdent.toUpperCase() !== icaoIdent ? [icaoIdent, rawIdent] : [rawIdent];
      let flights: Array<Record<string, unknown>> = [];
      let faRes: Response | null = null;
      let faText = "";
      for (const ident of identsToTry) {
        const identEnc = encodeURIComponent(ident);
        faRes = await fetch(`${AEROAPI_BASE}/flights/${identEnc}?ident_type=designator&max_pages=3`, { headers });
        faText = await faRes.text();
        let faJson: { flights?: Array<Record<string, unknown>> } = {};
        try {
          faJson = faText ? JSON.parse(faText) : {};
        } catch {
          faJson = {};
        }
        flights = Array.isArray(faJson.flights) ? faJson.flights : [];
        if (flights.length > 0) break;
      }
      let fromSearch = false;
      if (flights.length === 0 && faRes?.ok) {
        // 2) Fallback: /flights/search (airborne only)
        for (const ident of identsToTry) {
          const searchQuery = `-identOrReg ${ident}`;
          faRes = await fetch(
            `${AEROAPI_BASE}/flights/search?query=${encodeURIComponent(searchQuery)}&max_pages=1`,
            { headers }
          );
          faText = await faRes.text();
          if (faRes.ok) {
            try {
              const searchJson = faText ? JSON.parse(faText) : {};
              flights = Array.isArray(searchJson.flights) ? searchJson.flights : [];
              if (flights.length > 0) {
                fromSearch = true;
                break;
              }
            } catch {
              flights = [];
            }
          }
        }
      }
      const lastStatus = faRes?.status;
      if (flights.length === 0 && faRes && !faRes.ok) {
        const detail =
          faText.length > 0
            ? (() => {
                try {
                  const j = JSON.parse(faText);
                  return j.detail || j.reason || faText.slice(0, 200);
                } catch {
                  return faText.slice(0, 200);
                }
              })()
            : `HTTP ${lastStatus}`;
        sendJson(res, 502, {
          ok: false,
          message: `FlightAware API error: ${detail}`,
        });
        return;
      }
      // Prefer a flight that has gate/terminal data when API returns multiple
      const withGates = flights.find(
        (x) =>
          (x.gate_origin ?? x.gateOrigin ?? x.gate_destination ?? x.gateDestination) &&
          String(x.gate_origin ?? x.gateOrigin ?? x.gate_destination ?? x.gateDestination).trim()
      );
      const f = withGates ?? flights[0];
      if (!f) {
        sendJson(res, 404, {
          ok: false,
          message: `未找到航班 ${q}。请检查航班号或稍后再试。`,
        });
        return;
      }
      const instance = flightToInstance(f, q);
      sendJson(res, 200, {
        ok: true,
        data: {
          instance,
          badge: { label: fromSearch ? "LIVE" : "SCHEDULED", class: fromSearch ? "ok" : "neutral" },
          updated: "FlightAware",
        },
      });
    } catch (e) {
      sendJson(res, 500, {
        ok: false,
        message:
          (e instanceof Error ? e.message : String(e)) ||
          "Flight lookup failed.",
      });
    }
  };
}
