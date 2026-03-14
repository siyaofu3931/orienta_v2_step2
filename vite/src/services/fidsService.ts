/**
 * FIDS (Flight Information Display System) Service
 * Fetches departures/arrivals for PEK T3E international flights.
 * Supports: mock data (default), AviationStack API, or backend proxy.
 * Refresh: 1 hour to save API traffic.
 */

export type FidsFlight = {
  flight: string;
  origin?: string;
  destination?: string;
  scheduledTime: string;
  status: string;
  gate?: string;
};

const REFRESH_MS = 60 * 60 * 1000; // 1 hour

// Mock PEK T3E international flights (from passengerSim)
const MOCK_DEPARTURES: FidsFlight[] = [
  { flight: "CA783", destination: "Frankfurt", scheduledTime: "3:28pm", status: "On Time", gate: "E15" },
  { flight: "CA837", destination: "London", scheduledTime: "3:45pm", status: "Boarding", gate: "E19" },
  { flight: "CA781", destination: "Paris", scheduledTime: "4:10pm", status: "Final Call", gate: "E22" },
  { flight: "CA831", destination: "Amsterdam", scheduledTime: "4:50pm", status: "On Time", gate: "E26" },
  { flight: "CA903", destination: "Tokyo", scheduledTime: "4:20pm", status: "Boarding", gate: "E12" },
  { flight: "CA935", destination: "Los Angeles", scheduledTime: "5:30pm", status: "On Time", gate: "E08" },
  { flight: "CA911", destination: "Sydney", scheduledTime: "4:15pm", status: "Boarding", gate: "E05" },
  { flight: "CA921", destination: "Seoul", scheduledTime: "4:25pm", status: "Boarding", gate: "E30" },
  { flight: "CA741", destination: "Manila", scheduledTime: "2:50pm", status: "Departed", gate: "E33" },
  { flight: "CA861", destination: "Singapore", scheduledTime: "3:00pm", status: "Departed", gate: "E36" },
];

const MOCK_ARRIVALS: FidsFlight[] = [
  { flight: "CA836", origin: "London", scheduledTime: "1:20pm", status: "Landed", gate: "E02" },
  { flight: "CA856", origin: "Frankfurt", scheduledTime: "1:35pm", status: "Landed", gate: "E04" },
  { flight: "CA901", origin: "Tokyo", scheduledTime: "1:45pm", status: "Landed", gate: "E06" },
  { flight: "CA902", origin: "Seoul", scheduledTime: "1:50pm", status: "Landed", gate: "E08" },
  { flight: "CA921", origin: "Sydney", scheduledTime: "1:15pm", status: "Landed", gate: "E10" },
  { flight: "CA931", origin: "Los Angeles", scheduledTime: "1:10pm", status: "Landed", gate: "E12" },
  { flight: "CA841", origin: "Paris", scheduledTime: "1:30pm", status: "Landed", gate: "E14" },
  { flight: "CA861", origin: "Amsterdam", scheduledTime: "1:40pm", status: "Landed", gate: "E16" },
  { flight: "UA851", origin: "San Francisco", scheduledTime: "3:28pm", status: "On Time", gate: "E18" },
  { flight: "LH720", origin: "Munich", scheduledTime: "4:50pm", status: "On Time", gate: "E20" },
];

async function fetchAviationStack(airport: string, mode: "dep" | "arr"): Promise<FidsFlight[]> {
  const key = import.meta.env.VITE_AVIATIONSTACK_KEY;
  if (!key) return [];

  const params = new URLSearchParams({
    access_key: key,
    limit: "30",
    ...(mode === "dep" ? { dep_iata: airport } : { arr_iata: airport }),
  });
  const url = `https://api.aviationstack.com/v1/flights?${params}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) return [];

  const to12h = (iso: string) => {
    if (!iso) return "—";
    const m = iso.match(/T(\d{2}):(\d{2})/);
    if (!m) return "—";
    const h = parseInt(m[1], 10);
    const min = m[2];
    const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${h12}:${min}${h >= 12 ? "pm" : "am"}`;
  };
  const data = (json.data || []) as any[];
  return data.map((f: any) => ({
    flight: f.flight?.iata || f.flight?.number || "—",
    origin: f.departure?.airport || f.departure?.iata,
    destination: f.arrival?.airport || f.arrival?.iata,
    scheduledTime: mode === "dep" ? to12h(f.departure?.scheduled) : to12h(f.arrival?.scheduled),
    status: f.flight_status === "active" ? "En Route" : f.flight_status === "landed" ? "Landed" : (f.flight_status || "—"),
    gate: f.departure?.gate || f.arrival?.gate || "—",
  }));
}

async function fetchFromBackend(airport: string, mode: "dep" | "arr"): Promise<FidsFlight[]> {
  try {
    const res = await fetch(`/flight/${mode}?airport=${airport}`);
    if (!res.ok) return [];
    const json = await res.json();
    return (json.data || json.flights || []).map((f: any) => ({
      flight: f.flight || f.flight_iata || "—",
      origin: f.origin || f.departure?.airport,
      destination: f.destination || f.arrival?.airport,
      scheduledTime: f.scheduledTime || f.departure?.scheduled?.slice(11, 16) || f.arrival?.scheduled?.slice(11, 16) || "—",
      status: f.status || "On Time",
      gate: f.gate || "—",
    }));
  } catch {
    return [];
  }
}

export async function fetchDepartures(airport: string): Promise<FidsFlight[]> {
  const key = import.meta.env.VITE_AVIATIONSTACK_KEY;
  if (key) {
    const api = await fetchAviationStack(airport, "dep");
    if (api.length > 0) return api;
  }
  const backend = await fetchFromBackend(airport, "dep");
  if (backend.length > 0) return backend;
  if (airport === "SFO") {
    return [
      { flight: "UA851", destination: "Beijing", scheduledTime: "1:15pm", status: "On Time", gate: "G14" },
      { flight: "CA986", destination: "Beijing", scheduledTime: "2:30pm", status: "Boarding", gate: "G13" },
      { flight: "AA302", destination: "Dallas", scheduledTime: "3:00pm", status: "On Time", gate: "G3" },
      { flight: "DL504", destination: "New York", scheduledTime: "3:45pm", status: "On Time", gate: "G7" },
      { flight: "WN400", destination: "Las Vegas", scheduledTime: "4:10pm", status: "On Time", gate: "D5" },
      { flight: "AS712", destination: "Seattle", scheduledTime: "4:30pm", status: "On Time", gate: "D10" },
    ];
  }
  return MOCK_DEPARTURES;
}

export async function fetchArrivals(airport: string): Promise<FidsFlight[]> {
  const key = import.meta.env.VITE_AVIATIONSTACK_KEY;
  if (key) {
    const api = await fetchAviationStack(airport, "arr");
    if (api.length > 0) return api;
  }
  const backend = await fetchFromBackend(airport, "arr");
  if (backend.length > 0) return backend;
  if (airport === "SFO") {
    return [
      { flight: "B6133", origin: "New York", scheduledTime: "12:30pm", status: "Landed", gate: "A3" },
      { flight: "UA388", origin: "Tokyo", scheduledTime: "1:00pm", status: "Landed", gate: "F12" },
      { flight: "CX872", origin: "Hong Kong", scheduledTime: "1:45pm", status: "Landed", gate: "F7" },
      { flight: "LH456", origin: "Frankfurt", scheduledTime: "2:15pm", status: "On Time", gate: "A8" },
      { flight: "AA202", origin: "Los Angeles", scheduledTime: "2:30pm", status: "On Time", gate: "B15" },
      { flight: "QF74", origin: "Sydney", scheduledTime: "2:45pm", status: "On Time", gate: "F18" },
    ];
  }
  return MOCK_ARRIVALS;
}

export { REFRESH_MS };
