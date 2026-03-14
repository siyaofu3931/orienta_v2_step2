import React, { useEffect, useState } from "react";
import type { FidsFlight } from "../services/fidsService";
import { fetchDepartures, fetchArrivals, REFRESH_MS } from "../services/fidsService";

const FIDS_STYLE: React.CSSProperties = {
  background: "linear-gradient(180deg, #0c2340 0%, #1a365d 100%)",
  borderRadius: 12,
  padding: 16,
  color: "#e8f4fc",
  fontFamily: "'JetBrains Mono', 'SF Mono', 'Consolas', monospace",
  width: "100%",
  minWidth: 200,
  height: "100%",
  display: "flex",
  flexDirection: "column",
  boxShadow: "inset 0 0 40px rgba(0,0,0,0.2), 0 4px 20px rgba(0,0,0,0.15)",
  border: "1px solid rgba(255,255,255,0.08)",
};

function formatTime() {
  return new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
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
    return () => { cancelled = true; clearInterval(t); clearInterval(r); };
  }, [airport]);

  return (
    <div style={FIDS_STYLE}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, paddingBottom: 8, borderBottom: "2px solid rgba(255,255,255,0.2)" }}>
        <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: 1 }}>DEPARTURES</span>
        <span style={{ fontSize: 14, opacity: 0.9 }}>{time}</span>
      </div>
      <div style={{ fontSize: 11, opacity: 0.7, display: "grid", gridTemplateColumns: "0.7fr 0.7fr 0.5fr 1fr", gap: 4, marginBottom: 8 }}>
        <span>Time</span>
        <span>Flight</span>
        <span>Gate</span>
        <span>Status</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", fontSize: 13 }}>
        {loading ? (
          <div style={{ opacity: 0.6, padding: 20 }}>Loading…</div>
        ) : (
          flights.slice(0, 12).map((f, i) => (
            <div key={`${f.flight}-${i}`} style={{ display: "grid", gridTemplateColumns: "0.7fr 0.7fr 0.5fr 1fr", gap: 4, padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <span>{f.scheduledTime}</span>
              <span style={{ fontWeight: 600 }}>{f.flight}</span>
              <span>{f.gate || "—"}</span>
              <span style={{ color: f.status === "Boarding" || f.status === "Final Call" ? "#ffcc00" : f.status === "Departed" ? "#8e8e93" : "#34c759" }}>{f.status}</span>
            </div>
          ))
        )}
      </div>
      <div style={{ fontSize: 10, opacity: 0.5, marginTop: 8 }}>PEK T3E · Intl · Refresh 1h</div>
    </div>
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
    return () => { cancelled = true; clearInterval(t); clearInterval(r); };
  }, [airport]);

  return (
    <div style={FIDS_STYLE}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, paddingBottom: 8, borderBottom: "2px solid rgba(255,255,255,0.2)" }}>
        <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: 1 }}>ARRIVALS</span>
        <span style={{ fontSize: 14, opacity: 0.9 }}>{time}</span>
      </div>
      <div style={{ fontSize: 11, opacity: 0.7, display: "grid", gridTemplateColumns: "1fr 0.6fr 0.5fr 0.8fr", gap: 4, marginBottom: 8 }}>
        <span>Origin</span>
        <span>Time</span>
        <span>Gate</span>
        <span>Status</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", fontSize: 13 }}>
        {loading ? (
          <div style={{ opacity: 0.6, padding: 20 }}>Loading…</div>
        ) : (
          flights.slice(0, 12).map((f, i) => (
            <div key={`${f.flight}-${i}`} style={{ display: "grid", gridTemplateColumns: "1fr 0.6fr 0.5fr 0.8fr", gap: 4, padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <span style={{ fontWeight: 500 }}>{f.origin || f.flight}</span>
              <span>{f.scheduledTime}</span>
              <span>{f.gate || "—"}</span>
              <span style={{ color: f.status === "Landed" ? "#34c759" : f.status === "En Route" ? "#0a84ff" : "#8e8e93" }}>{f.status}</span>
            </div>
          ))
        )}
      </div>
      <div style={{ fontSize: 10, opacity: 0.5, marginTop: 8 }}>PEK T3E · Intl · Refresh 1h</div>
    </div>
  );
}
