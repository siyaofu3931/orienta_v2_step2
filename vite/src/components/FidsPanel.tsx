import React, { useEffect, useState } from "react";
import type { FidsFlight } from "../services/fidsService";
import { fetchDepartures, fetchArrivals, REFRESH_MS } from "../services/fidsService";

/** Green FIDS (departures / arrivals board) */
const FIDS: {
  bg: string;
  rowA: string;
  rowB: string;
  label: string;
  font: string;
} = {
  bg: "#051910",
  rowA: "#071f15",
  rowB: "#0a261a",
  label: "rgba(255,255,255,0.58)",
  font: 'system-ui, -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif',
};

const SHELL: React.CSSProperties = {
  background: `linear-gradient(180deg, ${FIDS.rowB} 0%, ${FIDS.bg} 32%, ${FIDS.bg} 100%)`,
  borderRadius: 6,
  padding: "14px 14px 10px",
  color: "#fff",
  fontFamily: FIDS.font,
  width: "100%",
  minWidth: 200,
  height: "100%",
  display: "flex",
  flexDirection: "column",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 28px rgba(0,0,0,0.45)",
  border: "1px solid rgba(24, 72, 52, 0.65)",
};

const AIRLINE_BG: Record<string, string> = {
  CA: "#c8102e",
  UA: "#0033a0",
  LH: "#05164d",
  EK: "#d71921",
  DL: "#003087",
  AA: "#0078d2",
  AS: "#01426a",
  WN: "#304cb2",
  B6: "#003087",
  CX: "#006564",
  QF: "#e40000",
  JL: "#d7003a",
  NH: "#13448f",
  BR: "#007749",
  SQ: "#004d97",
  TK: "#e30a17",
  AF: "#002157",
  BA: "#075aaa",
  IB: "#d71921",
  AC: "#f01428",
  FZ: "#00a651",
};

function formatTime() {
  return new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
}

/** IATA carrier: two letters (CA, UA) or letter+digit (B6, 3U) + numeric flight id */
function parseFlight(flight: string): { code: string; num: string } {
  const s = flight.trim().toUpperCase();
  const m = s.match(/^([A-Z]{2}|[A-Z]\d)(\d[\dA-Z]*)$/);
  if (m) return { code: m[1], num: m[2] };
  return { code: "•", num: flight };
}

function airlineBg(code: string): string {
  return AIRLINE_BG[code] || "#124530";
}

const KIWI_LOGO = (iata: string) =>
  `https://images.kiwi.com/airlines/64x64/${encodeURIComponent(iata)}.png`;

function AirlineLogo({ code }: { code: string }) {
  const [failed, setFailed] = useState(false);
  const bg = airlineBg(code);
  const useFallback = failed || code === "•" || code.length < 2;

  if (useFallback) {
    return (
      <span
        title={code === "•" ? undefined : code}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 34,
          height: 24,
          borderRadius: 3,
          background: bg,
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: 0.2,
          color: "#fff",
          flexShrink: 0,
          lineHeight: 1,
        }}
      >
        {code === "•" ? "—" : code}
      </span>
    );
  }

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 36,
        height: 24,
        borderRadius: 3,
        background: "#f0f2f1",
        overflow: "hidden",
        flexShrink: 0,
        border: "1px solid rgba(0,0,0,0.12)",
        boxSizing: "border-box",
      }}
    >
      <img
        src={KIWI_LOGO(code)}
        alt=""
        width={32}
        height={22}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        style={{ objectFit: "contain", display: "block", width: 32, height: 22 }}
        onError={() => setFailed(true)}
      />
    </span>
  );
}

const COL_GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0,1.35fr) 56px minmax(72px,0.95fr) 40px minmax(52px,1fr)",
  gap: "0 8px",
  alignItems: "center",
};

function FidsBoard({
  title,
  airport,
  mode,
  flights,
  loading,
  time,
}: {
  title: string;
  airport: string;
  mode: "dep" | "arr";
  flights: FidsFlight[];
  loading: boolean;
  time: string;
}) {
  const placeLabel = mode === "dep" ? "Destination" : "Origin";

  return (
    <div style={SHELL}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 10,
          paddingBottom: 2,
        }}
      >
        <span style={{ fontSize: 22, fontWeight: 700, color: "#fff", letterSpacing: -0.3 }}>{title}</span>
        <span style={{ fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.88)" }}>{time}</span>
      </div>

      <div
        style={{
          ...COL_GRID,
          fontSize: 11,
          fontWeight: 600,
          color: FIDS.label,
          padding: "6px 0 8px",
          borderBottom: "1px solid rgba(255,255,255,0.18)",
          marginBottom: 2,
        }}
      >
        <span>{placeLabel}</span>
        <span style={{ textAlign: "left" }}>Time</span>
        <span>Flight</span>
        <span>Gate</span>
        <span style={{ textAlign: "right" }}>Status</span>
      </div>

      <div style={{ flex: 1, overflowY: "auto", fontSize: 13, fontWeight: 700 }}>
        {loading ? (
          <div style={{ opacity: 0.5, padding: 20, fontWeight: 600 }}>Loading…</div>
        ) : (
          flights.slice(0, 12).map((f, i) => {
            const place = mode === "dep" ? (f.destination || "—") : (f.origin || "—");
            const { code, num } = parseFlight(f.flight);
            const rowBg = i % 2 === 0 ? FIDS.rowA : FIDS.rowB;
            return (
              <div
                key={`${f.flight}-${i}`}
                style={{
                  ...COL_GRID,
                  background: rowBg,
                  margin: "0 -6px",
                  padding: "10px 6px",
                  borderBottom: "1px solid rgba(0,0,0,0.2)",
                }}
              >
                <span style={{ color: "#fff", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {place}
                </span>
                <span style={{ color: "#fff", fontWeight: 700 }}>{f.scheduledTime}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <AirlineLogo code={code} />
                  <span style={{ color: "#fff", fontWeight: 700, letterSpacing: 0.2 }}>{num}</span>
                </span>
                <span style={{ color: "#fff", fontWeight: 700 }}>{f.gate || "—"}</span>
                <span
                  style={{
                    color: "#fff",
                    fontWeight: 700,
                    textAlign: "right",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {f.status}
                </span>
              </div>
            );
          })
        )}
      </div>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", marginTop: 8, fontWeight: 500 }}>
        {airport} · refresh 1h
      </div>
    </div>
  );
}

export function DeparturesFids({ airport }: { airport: string }) {
  const [flights, setFlights] = useState<FidsFlight[]>([]);
  const [time, setTime] = useState(formatTime());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const data = await fetchDepartures(airport);
      if (!cancelled) setFlights(data);
      setLoading(false);
    };
    load();
    const t = setInterval(() => setTime(formatTime()), 1000);
    const r = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
      clearInterval(r);
    };
  }, [airport]);

  return (
    <FidsBoard title="Departures" airport={airport} mode="dep" flights={flights} loading={loading} time={time} />
  );
}

export function ArrivalsFids({ airport }: { airport: string }) {
  const [flights, setFlights] = useState<FidsFlight[]>([]);
  const [time, setTime] = useState(formatTime());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const data = await fetchArrivals(airport);
      if (!cancelled) setFlights(data);
      setLoading(false);
    };
    load();
    const t = setInterval(() => setTime(formatTime()), 1000);
    const r = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
      clearInterval(r);
    };
  }, [airport]);

  return (
    <FidsBoard title="Arrivals" airport={airport} mode="arr" flights={flights} loading={loading} time={time} />
  );
}
