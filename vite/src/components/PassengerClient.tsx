import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Gate, Flight, PassengerComputed } from "../services/types";
import { buildT3EGates, buildIntlFlights, createWorld, stepWorld, computePassenger, T3E_SPINE_CENTER } from "../services/passengerSim";
import { connectPaxRealtime, type MsgRecord, type ChatMessage } from "../services/realtime";

function qs(name: string) {
  try { return new URL(location.href).searchParams.get(name); } catch { return null; }
}

const PAX_OPTIONS = [
  { value: "TX1", label: "TX1 · Premium · Urgent (London)" },
  { value: "TX2", label: "TX2 · Premium · Tight (Frankfurt)" },
  { value: "P6",  label: "P6 · Free · Missed (Singapore)" },
  { value: "P8",  label: "P8 · Premium · Lost Location" },
  { value: "P3",  label: "P3 · Premium · ♿ Wheelchair" },
  { value: "P5",  label: "P5 · Free · Shopping" },
  { value: "P7",  label: "P7 · Premium · At Gate" },
  { value: "P9",  label: "P9 · Free · Offline" },
];

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function ChatBubble({ msg }: { msg: ChatMessage }) {
  const isMe = msg.from === "pax";
  const bgMap: Record<string, string> = {
    pax: "#0a84ff",
    admin: "rgba(255,255,255,0.13)",
    agent: "#5e5ce6",
    system: "rgba(255,159,10,0.18)",
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: isMe ? "flex-end" : "flex-start", marginBottom: 8 }}>
      <span style={{ fontSize: 10, opacity: 0.5, marginBottom: 2 }}>
        {msg.from === "agent" ? "🤖 Orienta AI" : msg.from === "admin" ? "✈️ Operator" : msg.from === "system" ? "⚙️ System" : "You"} · {formatTime(msg.createdAt)}
      </span>
      <div style={{
        maxWidth: "85%", padding: "8px 13px", borderRadius: 14,
        borderBottomRightRadius: isMe ? 3 : 14, borderBottomLeftRadius: isMe ? 14 : 3,
        background: bgMap[msg.from] || "#444", fontSize: 14, lineHeight: 1.5,
        wordBreak: "break-word", fontStyle: msg.from === "system" ? "italic" : "normal",
      }}>
        {msg.body}
      </div>
    </div>
  );
}

// Minimal Apple Map or Leaflet display for route
function RouteMap({ pax, gate }: { pax: PassengerComputed | null; gate: Gate | null }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const leafletRef = useRef<any>(null);
  const mapInstanceRef = useRef<any>(null);

  useEffect(() => {
    if (!mapRef.current) return;
    const L = (window as any).L;
    if (!L) {
      // Load leaflet
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
      document.head.appendChild(link);
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
      script.onload = () => { setMapLoaded(true); leafletRef.current = (window as any).L; };
      document.head.appendChild(script);
    } else {
      leafletRef.current = L;
      setMapLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !leafletRef.current) return;
    const L = leafletRef.current;

    if (!mapInstanceRef.current) {
      const center = pax?.location || T3E_SPINE_CENTER;
      const map = L.map(mapRef.current, { zoomControl: true }).setView([center.lat, center.lng], 16);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap", maxZoom: 19
      }).addTo(map);
      mapInstanceRef.current = map;
    }

    const map = mapInstanceRef.current;
    map.eachLayer((l: any) => {
      if (l._orienta) map.removeLayer(l);
    });

    if (!pax || !gate) return;

    // Draw route polyline
    if (pax.path && pax.path.length > 1) {
      const pathCoords = pax.path.map(p => [p.lat, p.lng]);
      const routeLine = L.polyline(pathCoords, { color: "#0a84ff", weight: 3, opacity: 0.8, dashArray: "6,4" }).addTo(map);
      routeLine._orienta = true;
    }

    // Passenger marker
    const paxIcon = L.divIcon({
      className: "",
      html: `<div style="width:18px;height:18px;border-radius:50%;background:#0a84ff;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4)"></div>`,
      iconSize: [18, 18], iconAnchor: [9, 9]
    });
    const paxMarker = L.marker([pax.location.lat, pax.location.lng], { icon: paxIcon }).addTo(map);
    paxMarker._orienta = true;
    paxMarker.bindPopup("You are here");

    // Gate marker
    const gateIcon = L.divIcon({
      className: "",
      html: `<div style="background:#34c759;color:#000;border-radius:6px;padding:2px 6px;font-size:11px;font-weight:700;white-space:nowrap">🚪 ${gate.name}</div>`,
      iconSize: [60, 22], iconAnchor: [30, 11]
    });
    const gateMarker = L.marker([gate.coordinate.lat, gate.coordinate.lng], { icon: gateIcon }).addTo(map);
    gateMarker._orienta = true;

    // Fit bounds
    const bounds: [number, number][] = [[pax.location.lat, pax.location.lng], [gate.coordinate.lat, gate.coordinate.lng]];
    try { map.fitBounds(bounds, { padding: [30, 30] }); } catch {}

    setTimeout(() => map.invalidateSize(), 100);
  }, [mapLoaded, pax?.location.lat, pax?.location.lng, gate?.coordinate.lat]);

  return (
    <div style={{ borderRadius: 12, overflow: "hidden", height: 260, position: "relative" }}>
      <div ref={mapRef} style={{ width: "100%", height: "100%" }} />
      {!mapLoaded && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#2c2c2e", fontSize: 12, opacity: 0.6 }}>
          Loading map…
        </div>
      )}
    </div>
  );
}

export default function PassengerClient() {
  const tenantId = "airchina";
  const [passengerId, setPassengerId] = useState<string>(
    () => qs("pid") || localStorage.getItem("orienta_pax_pid") || "TX1"
  );

  const gates = useMemo(() => buildT3EGates(), []);
  const flights = useMemo(() => buildIntlFlights(), []);
  const gatesById = useMemo(() => new Map(gates.map(g => [g.id, g])), [gates]);
  const flightsById = useMemo(() => new Map(flights.map(f => [f.id, f])), [flights]);

  const [world, setWorld] = useState<any>(null);
  const [connected, setConnected] = useState(false);

  const [inbox, setInbox] = useState<MsgRecord[]>([]);
  const [activeMsg, setActiveMsg] = useState<MsgRecord | null>(null);
  const [acked, setAcked] = useState<Record<string, boolean>>({});

  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [locRequestPending, setLocRequestPending] = useState(false);
  const [locInput, setLocInput] = useState("");

  const rtRef = useRef<ReturnType<typeof connectPaxRealtime> | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem("orienta_pax_pid", passengerId);
  }, [passengerId]);

  useEffect(() => {
    const w = createWorld(gates, flights, 30);
    setWorld(w);
  }, [passengerId]);

  useEffect(() => {
    if (!world) return;
    const t = setInterval(() => setWorld((w: any) => stepWorld(w, gatesById, 1000)), 1000);
    return () => clearInterval(t);
  }, [world, gatesById]);

  // Reset chat when pax changes
  useEffect(() => {
    setChatHistory([]);
    setInbox([]);
    setAcked({});
    setActiveMsg(null);
    setLocRequestPending(false);
  }, [passengerId]);

  // Realtime
  useEffect(() => {
    const rt = connectPaxRealtime({
      tenantId,
      passengerId,
      onConnectionChange: setConnected,
      onMessage: (rec) => {
        setInbox(xs => [rec, ...xs].slice(0, 30));
        setActiveMsg(rec);
      },
      onAckOk: (id) => setAcked(m => ({ ...m, [id]: true })),
      onChatMsg: (msg) => {
        setChatHistory(h => [...h, msg].slice(-50));
        if (msg.from !== "pax") setChatOpen(true);
        setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
      },
      onChatHistory: (msgs) => setChatHistory(msgs),
      onLocRequest: () => {
        setLocRequestPending(true);
        setChatOpen(true);
      },
    });
    rtRef.current = rt;
    return () => { rtRef.current = null; rt.close(); };
  }, [tenantId, passengerId]);

  const pax: PassengerComputed | null = useMemo(() => {
    if (!world?.passengers) return null;
    const raw = world.passengers.find((p: any) => p.id === passengerId);
    if (!raw) return null;
    const gate = gatesById.get(raw.gateId) || null;
    const flight = flightsById.get(raw.flightId) || null;
    return computePassenger(raw, flight, gate);
  }, [world, passengerId, gatesById, flightsById]);

  const gate = pax ? gatesById.get(pax.gateId) || null : null;
  const flight = pax ? flightsById.get(pax.flightId) || null : null;
  const isPremium = pax?.plan === "premium";

  const newUnread = chatHistory.filter(m => m.from !== "pax").length;

  const onAck = () => {
    if (!activeMsg) return;
    rtRef.current?.ack(activeMsg.messageId);
    setAcked(m => ({ ...m, [activeMsg.messageId]: true }));
    setActiveMsg(null);
  };

  const sendChat = () => {
    const t = chatInput.trim();
    if (!t) return;
    rtRef.current?.chatSend(t, "text");
    setChatInput("");
    setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  };

  const sendLocation = () => {
    const t = locInput.trim();
    if (!t) return;
    rtRef.current?.chatSend(`My current location: ${t}`, "location", t);
    setLocInput("");
    setLocRequestPending(false);
  };

  const depTime = flight ? new Date(flight.scheduledDep) : null;
  const minsToDepart = depTime ? Math.round((depTime.getTime() - Date.now()) / 60000) : null;
  const statusColor = { green: "#34c759", yellow: "#ffcc00", red: "#ff3b30", gray: "#8e8e93" }[pax?.status || "gray"];

  return (
    <div style={{ background: "#000", color: "#fff", minHeight: "100vh", fontFamily: "-apple-system,BlinkMacSystemFont,sans-serif" }}>
      {/* Header */}
      <div style={{ padding: "14px 16px", background: "#1c1c1e", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 100, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 18 }}>✈️ Orienta</span>
          <span style={{ fontSize: 11, opacity: 0.5, background: "rgba(255,255,255,0.08)", padding: "2px 8px", borderRadius: 6 }}>Passenger</span>
          <span style={{ fontSize: 11, background: connected ? "#34c75922" : "#ff3b3022", color: connected ? "#34c759" : "#ff3b30", padding: "2px 8px", borderRadius: 6 }}>
            {connected ? "● Connected" : "○ Connecting…"}
          </span>
        </div>
        <select
          value={passengerId}
          onChange={e => setPassengerId(e.target.value)}
          style={{ background: "rgba(255,255,255,0.08)", color: "#fff", border: "none", borderRadius: 8, padding: "5px 10px", fontSize: 12 }}
        >
          {PAX_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div style={{ padding: 16, maxWidth: 500, margin: "0 auto" }}>
        {/* Flight Card */}
        {pax && (
          <div style={{ background: "#1c1c1e", borderRadius: 16, padding: 16, marginBottom: 16, border: `1px solid ${statusColor}33` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{pax.name}</div>
                <div style={{ fontSize: 13, opacity: 0.6, marginTop: 2 }}>
                  {pax.nationality} · {pax.plan === "premium" ? "💎 Premium" : "Free"} {pax.needsWheelchair ? "· ♿" : ""}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 2 }}>Status</div>
                <div style={{ color: statusColor, fontWeight: 700, fontSize: 14 }}>
                  {pax.extStatus === "missed" ? "❌ Missed" :
                   pax.extStatus === "offline" ? "📵 Offline" :
                   pax.extStatus === "lost" ? "📍 Lost" :
                   pax.reason}
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 14 }}>
              <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 10, padding: "8px 10px" }}>
                <div style={{ fontSize: 10, opacity: 0.5, marginBottom: 2 }}>Inbound</div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{pax.transfer.inboundFlight}</div>
                <div style={{ fontSize: 11, opacity: 0.6 }}>from {pax.transfer.inboundFrom}</div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 10, padding: "8px 10px" }}>
                <div style={{ fontSize: 10, opacity: 0.5, marginBottom: 2 }}>Outbound</div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{pax.flightId}</div>
                <div style={{ fontSize: 11, opacity: 0.6 }}>to {pax.transfer.outboundTo}</div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 10, padding: "8px 10px" }}>
                <div style={{ fontSize: 10, opacity: 0.5, marginBottom: 2 }}>Gate</div>
                <div style={{ fontWeight: 700, fontSize: 18, color: "#34c759" }}>{gate?.name || pax.gateId}</div>
              </div>
            </div>

            {minsToDepart !== null && (
              <div style={{ marginTop: 12, background: minsToDepart < 15 ? "rgba(255,59,48,0.15)" : "rgba(255,255,255,0.05)", borderRadius: 10, padding: "8px 12px", display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, opacity: 0.7 }}>Departs in</span>
                <span style={{ fontWeight: 700, fontSize: 15, color: minsToDepart < 15 ? "#ff3b30" : minsToDepart < 30 ? "#ffcc00" : "#34c759" }}>
                  {minsToDepart > 0 ? `${minsToDepart} min` : "Boarding closed"}
                </span>
              </div>
            )}

            {pax.etaMinutes !== null && pax.extStatus !== "missed" && (
              <div style={{ marginTop: 8, background: "rgba(255,255,255,0.05)", borderRadius: 10, padding: "8px 12px", display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, opacity: 0.7 }}>ETA to gate</span>
                <span style={{ fontWeight: 700, fontSize: 15, color: statusColor }}>{pax.etaMinutes} min</span>
              </div>
            )}

            {pax.transfer.urgency === "urgent" && pax.extStatus !== "missed" && (
              <div style={{ marginTop: 10, background: "rgba(255,59,48,0.15)", borderRadius: 10, padding: "10px 12px", fontSize: 13, color: "#ff3b30", fontWeight: 600 }}>
                ⚠️ TIGHT CONNECTION — Proceed to gate immediately. Do not stop.
              </div>
            )}
          </div>
        )}

        {/* Navigation Route Card */}
        {pax && pax.extStatus !== "missed" && gate && (
          <div style={{ background: "#1c1c1e", borderRadius: 16, padding: 16, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 15 }}>🗺️ Navigation to Gate {gate.name}</h3>
            </div>

            {/* Transfer Route Steps */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 6 }}>I→I Transfer Route (T3E)</div>
              {[
                { step: "1", icon: "🔐", text: `Transfer Security Check (Level 3)`, sub: "Carry-on screening, no immigration" },
                { step: "2", icon: "⬇️", text: "Take escalator to Level 2", sub: "Follow signs: International Departure Gates" },
                { step: "3", icon: "🚶", text: `Proceed to Gate ${gate.name}`, sub: pax.etaMinutes ? `ETA ~${pax.etaMinutes} min walk` : "Follow Orienta map" },
              ].map(s => (
                <div key={s.step} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <div style={{ width: 24, height: 24, borderRadius: 12, background: "#0a84ff22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{s.icon}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{s.text}</div>
                    <div style={{ fontSize: 11, opacity: 0.5 }}>{s.sub}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Map */}
            <RouteMap pax={pax} gate={gate} />
          </div>
        )}

        {/* Chat Panel */}
        <div style={{ background: "#1c1c1e", borderRadius: 16, overflow: "hidden", marginBottom: 16 }}>
          <button
            style={{ width: "100%", padding: "13px 16px", background: "transparent", border: "none", color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
            onClick={() => setChatOpen(o => !o)}
          >
            <span style={{ fontSize: 15, fontWeight: 600 }}>
              💬 Messages {chatHistory.length > 0 && <span style={{ background: "#ff3b30", borderRadius: 10, padding: "1px 7px", fontSize: 11, marginLeft: 6 }}>{chatHistory.length}</span>}
            </span>
            <span style={{ fontSize: 12, opacity: 0.5 }}>{chatOpen ? "▲" : "▼"}</span>
          </button>

          {chatOpen && (
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ maxHeight: 280, overflowY: "auto", padding: "12px 14px" }}>
                {chatHistory.length === 0 && (
                  <div style={{ opacity: 0.4, fontSize: 12, textAlign: "center" }}>No messages yet.</div>
                )}
                {chatHistory.map(m => <ChatBubble key={m.id} msg={m} />)}
                <div ref={chatBottomRef} />
              </div>

              {/* Location Report (when requested) */}
              {locRequestPending && (
                <div style={{ padding: "10px 14px", background: "rgba(255,159,10,0.1)", borderTop: "1px solid rgba(255,159,10,0.2)" }}>
                  <div style={{ fontSize: 12, color: "#ff9f0a", marginBottom: 6 }}>📍 Operator is requesting your location</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      value={locInput}
                      onChange={e => setLocInput(e.target.value)}
                      placeholder='e.g. "Near Gate E21 duty free"'
                      style={{ flex: 1, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,159,10,0.4)", borderRadius: 8, padding: "6px 10px", color: "#fff", fontSize: 13 }}
                      onKeyDown={e => e.key === "Enter" && sendLocation()}
                    />
                    <button style={{ background: "#ff9f0a", color: "#000", border: "none", borderRadius: 8, padding: "6px 14px", fontWeight: 700, cursor: "pointer" }} onClick={sendLocation}>
                      Send
                    </button>
                  </div>
                </div>
              )}

              {/* Chat Input */}
              <div style={{ padding: "10px 14px", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", gap: 6 }}>
                <input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  placeholder={isPremium ? "Message operator…" : "Ask AI assistant…"}
                  style={{ flex: 1, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "8px 12px", color: "#fff", fontSize: 13 }}
                  onKeyDown={e => e.key === "Enter" && sendChat()}
                />
                <button onClick={sendChat} style={{ background: "#0a84ff", color: "#fff", border: "none", borderRadius: 10, padding: "8px 14px", fontWeight: 700, cursor: "pointer" }}>
                  Send
                </button>
              </div>
              {!isPremium && (
                <div style={{ padding: "4px 14px 10px", fontSize: 10, opacity: 0.4 }}>
                  🤖 AI assistant · Upgrade to Premium for human operator support
                </div>
              )}
            </div>
          )}
        </div>

        {/* Message Inbox */}
        {inbox.length > 0 && (
          <div style={{ background: "#1c1c1e", borderRadius: 16, padding: 14, marginBottom: 16 }}>
            <h4 style={{ margin: "0 0 10px", fontSize: 13, opacity: 0.6 }}>Notifications ({inbox.length})</h4>
            {inbox.map(m => (
              <button key={m.messageId} onClick={() => setActiveMsg(m)}
                style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.04)", border: "none", color: "#fff", borderRadius: 10, padding: "8px 12px", marginBottom: 6, cursor: "pointer" }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{m.title}</span>
                <span style={{ fontSize: 10, opacity: 0.5 }}>{acked[m.messageId] ? "✓ Confirmed" : "Pending"}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Modal: notification requiring ack */}
      {activeMsg && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 9999, padding: 16 }}>
          <div style={{ background: "#1c1c1e", borderRadius: 20, padding: 20, width: "100%", maxWidth: 460, boxShadow: "0 8px 40px rgba(0,0,0,0.8)" }}>
            <div style={{ fontSize: 11, opacity: 0.4, marginBottom: 6 }}>✈️ Orienta · {formatTime(activeMsg.createdAt)}</div>
            <h3 style={{ margin: "0 0 10px", fontSize: 18 }}>{activeMsg.title}</h3>
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", margin: "0 0 14px" }} />
            <div style={{ fontSize: 15, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{activeMsg.body}</div>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button onClick={() => setActiveMsg(null)} style={{ flex: 1, padding: "12px", background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 12, color: "#fff", fontSize: 14, cursor: "pointer" }}>
                Later
              </button>
              <button onClick={onAck} style={{ flex: 2, padding: "12px", background: "#0a84ff", border: "none", borderRadius: 12, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                ✓ I've received this
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
