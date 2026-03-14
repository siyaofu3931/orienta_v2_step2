import React, { useEffect, useMemo, useRef, useState } from "react";
import TopBar from "./components/TopBar";
import type { MapMode as TopBarMapMode } from "./components/TopBar";
import MapView from "./components/Map/MapView";
import PassengerCard from "./components/PassengerCard";
import ToastHost, { ToastItem } from "./components/Toast";
import LoginScreen from "./components/LoginScreen";
import ConversationPanel from "./components/ConversationPanel";
import PaxEntryWrapper from "./components/PaxEntryWrapper";

import type { Gate, Flight, PassengerComputed, PaxExtStatus } from "./services/types";
import {
  buildT3EGates, buildIntlFlights, createWorld, stepWorld, computePassenger,
} from "./services/passengerSim";
import {
  buildSFOGates, buildSFOFlights, buildSFOWorld, stepSFOWorld,
} from "./services/passengerSimSFO";
import {
  getSession, loginWithPassword, loginWithSSO, logout as authLogout, type AdminSession,
} from "./services/auth";
import {
  connectAdminRealtime, type MsgRecord, type MsgStatusEvent, type PresenceEvent, type ChatMessage,
} from "./services/realtime";

export default function App() {
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/pax")) {
    return <PaxEntryWrapper />;
  }
  const [session, setSession] = useState<AdminSession | null>(() => getSession());
  if (!session) {
    return (
      <LoginScreen
        onLogin={(u, p) => setSession(loginWithPassword(u, p))}
        onSSO={() => setSession(loginWithSSO())}
      />
    );
  }
  return <Dashboard session={session} onLogout={() => { authLogout(); setSession(null); }} />;
}

type DashTab = "dashboard" | "map";
type Airport = "PEK" | "SFO";

function statusBadge(s: PaxExtStatus | string) {
  const map: Record<string, string> = {
    green: "#34c759", yellow: "#ffcc00", red: "#ff3b30",
    missed: "#8e8e93", offline: "#636366", lost: "#ff9f0a", gray: "#8e8e93",
  };
  return map[s] || "#8e8e93";
}

function extStatusLabel(s: PaxExtStatus): string {
  const m: Record<PaxExtStatus, string> = {
    green: "On Track", yellow: "Tight", red: "At Risk",
    missed: "Missed", offline: "Offline", lost: "Lost", gray: "Unknown",
  };
  return m[s] || s;
}

function RiskBadges({ counts }: { counts: Record<string, number> }) {
  const items = [
    { key: "green",   label: "On Track", color: "#34c759" },
    { key: "yellow",  label: "Tight",    color: "#ffcc00" },
    { key: "red",     label: "At Risk",  color: "#ff3b30" },
    { key: "lost",    label: "Lost",     color: "#ff9f0a" },
    { key: "offline", label: "Offline",  color: "#636366" },
    { key: "missed",  label: "Missed",   color: "#8e8e93" },
  ];
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
      {items.map(i => (
        <div key={i.key} style={{ display: "flex", alignItems: "center", gap: 4, background: "rgba(255,255,255,0.06)", borderRadius: 8, padding: "4px 10px" }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: i.color }}>{(counts as any)[i.key] || 0}</span>
          <span style={{ fontSize: 11, opacity: 0.7 }}>{i.label}</span>
        </div>
      ))}
    </div>
  );
}

function Dashboard({ session, onLogout }: { session: AdminSession; onLogout(): void }) {
  const [airport, setAirport] = useState<Airport>("PEK");
  const tenantId = airport === "PEK" ? "airchina" : "airchina_sfo";
  const [tab, setTab] = useState<DashTab>("dashboard");
  const [paused, setPaused] = useState(false);
  const [search, setSearch] = useState("");
  const [mapViewMode, setMapViewMode] = useState<"all" | "single" | "urgent">("all");
  const [mapModeByAirport, setMapModeByAirport] = useState<Record<Airport, TopBarMapMode>>({
    PEK: "auto",
    SFO: "auto",
  });
  const mapMode = mapModeByAirport[airport];
  const [passengersRaw, setPassengersRaw] = useState<any>(null);
  const [selectedPaxId, setSelectedPaxId] = useState<string | null>(null);
  const [hoverPaxId, setHoverPaxId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [openConvPaxId, setOpenConvPaxId] = useState<string | null>(null);

  // Wide layout: dock chat panel as right-most column (tablet/desktop, ~768px+)
  const [isWide, setIsWide] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.innerWidth >= 768;
  });
  useEffect(() => {
    const onResize = () => setIsWide(window.innerWidth >= 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const dockChat = tab === "map" && isWide;

  const [rtUp, setRtUp] = useState(false);
  const [presence, setPresence] = useState<Record<string, boolean>>({});
  const [msgById, setMsgById] = useState<Record<string, MsgRecord>>({});
  const [chatHistory, setChatHistory] = useState<Record<string, ChatMessage[]>>({});
  const rtRef = useRef<ReturnType<typeof connectAdminRealtime> | null>(null);

  // Gates & flights vary by airport
  const gates: Gate[] = useMemo(() => airport === "PEK" ? buildT3EGates() : buildSFOGates(), [airport]);
  const flights: Flight[] = useMemo(() => airport === "PEK" ? buildIntlFlights() : buildSFOFlights(), [airport]);
  const gatesById = useMemo(() => new Map(gates.map(g => [g.id, g])), [gates]);
  const flightsById = useMemo(() => new Map(flights.map(f => [f.id, f])), [flights]);

  // Reset world when airport changes
  useEffect(() => {
    setPassengersRaw(null);
    setSelectedPaxId(null);
    setMapViewMode("all");
    setChatHistory({});
    setPresence({});
    setTimeout(() => {
      if (airport === "PEK") {
        setPassengersRaw(createWorld(buildT3EGates(), buildIntlFlights(), 30));
      } else {
        const g = buildSFOGates();
        const f = buildSFOFlights();
        setPassengersRaw(buildSFOWorld(g, f));
      }
    }, 50);
  }, [airport]);

  // Step simulation
  useEffect(() => {
    if (paused || !passengersRaw) return;
    const gb = gatesById;
    const t = setInterval(() => {
      setPassengersRaw((w: any) =>
        airport === "PEK" ? stepWorld(w, gb, 1000) : stepSFOWorld(w, gb, 1000)
      );
    }, 1000);
    return () => clearInterval(t);
  }, [paused, passengersRaw, gatesById, airport]);

  // Realtime connection (reconnect on airport change)
  useEffect(() => {
    const rt = connectAdminRealtime({
      tenantId,
      onConnectionChange: setRtUp,
      onPresence: (e: PresenceEvent) => {
        setPresence(m => {
          const was = !!m[e.passengerId];
          const next = { ...m, [e.passengerId]: e.online };
          // Show toast on online transition (matches test expectation: "后台立刻看到上线")
          if (e.online && !was) {
            const display = (passengersRaw?.passengers || []).find((p: any) => p.id === e.passengerId)?.name || e.passengerId;
            const id = `t_${Date.now()}_${Math.random().toString(16).slice(2)}`;
            setToasts(t => [...t.slice(-4), { id, title: "Passenger online", body: `${display} (${e.passengerId})` }]);
            setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4500);
          }
          return next;
        });
      },
      onMsg: (r: MsgRecord) => setMsgById(m => ({ ...m, [r.messageId]: r })),
      onStatus: (e: MsgStatusEvent) => {
        setMsgById(m => {
          const cur = m[e.messageId]; if (!cur) return m;
          return { ...m, [e.messageId]: { ...cur, status: e.status, deliveredAt: e.deliveredAt ?? cur.deliveredAt, ackAt: e.ackAt ?? cur.ackAt } };
        });
      },
      onChatMsg: (msg: ChatMessage) => {
        setChatHistory(h => ({ ...h, [msg.passengerId]: [...(h[msg.passengerId] || []), msg].slice(-50) }));
      },
      onChatHistory: (pid: string, msgs: ChatMessage[]) => {
        setChatHistory(h => ({ ...h, [pid]: msgs }));
      },
      onChatRead: (pid: string, messageId: string, at: number) => {
        setChatHistory(h => ({
          ...h,
          [pid]: (h[pid] || []).map(m =>
            m.id === messageId ? { ...m, status: "read" as const, readAt: at } : m
          ),
        }));
      },
    });
    rtRef.current = rt;
    return () => { rtRef.current = null; rt.close(); };
  }, [tenantId]);

  const passengers: PassengerComputed[] = useMemo(() => {
    if (!passengersRaw?.passengers) return [];
    return passengersRaw.passengers.map((p: any) => {
      const isOnline = !!presence[p.id];

      // Compute ETA-based risk (green/yellow/red) once a previously-offline passenger comes online.
      // This is more "product-like" than a fixed offline→yellow flip.
      const pForCompute = (isOnline && p.extStatus === "offline")
        ? { ...p, extStatus: "green" } // avoid computePassenger short-circuiting to gray
        : p;

      const gate = gatesById.get(p.gateId) || null;
      const flight = flightsById.get(p.flightId) || null;
      const computed0 = computePassenger(pForCompute, flight, gate);

      let extStatus: PaxExtStatus = computed0.extStatus as PaxExtStatus;

      // Only override the "offline" demo state when the WS presence becomes online.
      if (isOnline && p.extStatus === "offline") {
        const s = computed0.status;
        extStatus = (s === "green" || s === "yellow" || s === "red") ? (s as any) : "yellow";
      }

      const computed: PassengerComputed = { ...computed0, extStatus };
      (computed as any).rtOnline = isOnline;
      return computed;
    });
  }, [passengersRaw, gatesById, flightsById, presence]);

  const hoverPax = useMemo(() =>
    hoverPaxId ? passengers.find(p => p.id === hoverPaxId) || null : null,
    [hoverPaxId, passengers]
  );

  const selectedPax = useMemo(() =>
    selectedPaxId ? passengers.find(p => p.id === selectedPaxId) || null : null,
    [selectedPaxId, passengers]
  );

  const pushToast = (title: string, body: string) => {
    const id = `t_${Date.now()}`;
    setToasts(t => [...t.slice(-4), { id, title, body }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4500);
  };

  const sendSms = (pid: string, msg: string) => {
    const rt = rtRef.current;
    if (!rt || !rt.isConnected()) { pushToast("Message sent (mock)", msg); return; }
    rt.send(pid, msg, "Orienta Alert");
    pushToast("Message sent", `→ ${pid}: ${msg.slice(0, 60)}`);
  };

  const sendChat = (pid: string, body: string) => {
    const msgId = `local_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const localMsg: ChatMessage = {
      id: msgId, passengerId: pid, tenantId, from: "admin", kind: "text", body,
      createdAt: Date.now(), status: "sending",
    };
    setChatHistory(h => ({ ...h, [pid]: [...(h[pid] || []), localMsg].slice(-50) }));
    if (rtRef.current?.isConnected()) {
      rtRef.current.chatSend(pid, body, "text");
      setChatHistory(h => ({
        ...h,
        [pid]: (h[pid] || []).map(m => m.id === msgId ? { ...m, status: "sent" as const } : m),
      }));
    }
  };

  const requestLocation = (pid: string) => {
    rtRef.current?.requestLocation(pid);
    pushToast("Location requested", `Sent location request to ${pid}`);
  };

  const openConversation = (pid: string) => {
    setOpenConvPaxId(pid);
    rtRef.current?.fetchHistory(pid);
  };

  const riskCounts = useMemo(() => {
    const counts = { green: 0, yellow: 0, red: 0, missed: 0, offline: 0, lost: 0 };
    for (const p of passengers) {
      const es = p.extStatus as keyof typeof counts;
      if (es in counts) counts[es]++;
    }
    return counts;
  }, [passengers]);

  // Gate search filter: filter passengers by gate name/id
  const passengersFilteredByGate = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return passengers;
    return passengers.filter(p => {
      const gateId = (p.gateId || "").toLowerCase();
      const gateName = (gatesById.get(p.gateId)?.name || "").toLowerCase();
      return gateId.includes(q) || gateName.includes(q);
    });
  }, [passengers, search, gatesById]);

  const priorityList = useMemo(() =>
    passengers
      .filter(p => ["lost", "red", "missed"].includes(p.extStatus) || p.transfer?.urgency === "urgent")
      .sort((a, b) => {
        const rank = (p: PassengerComputed) => {
          if (p.extStatus === "lost") return 0;
          if (p.extStatus === "red") return 1;
          if (p.transfer?.urgency === "urgent") return 2;
          if (p.extStatus === "missed") return 3;
          return 4;
        };
        return rank(a) - rank(b);
      })
      .slice(0, 8),
    [passengers]
  );

  // Passengers to display on map based on mapViewMode and gate search
  const mapPassengers = useMemo(() => {
    const base = passengersFilteredByGate;
    if (mapViewMode === "single" && selectedPaxId) {
      const p = base.find(x => x.id === selectedPaxId);
      return p ? [p] : [];
    }
    if (mapViewMode === "urgent") {
      const urgentIds = new Set(priorityList.map(p => p.id));
      return base.filter(p => urgentIds.has(p.id));
    }
    return base;
  }, [passengersFilteredByGate, mapViewMode, selectedPaxId, priorityList]);

  // Airport config
  const airportLabel = airport === "PEK"
    ? "国航 Demo · PEK T3E · 国际→国际"
    : "国航 Demo · SFO · 国际→国内";
  const mapLabel = airport === "PEK" ? "🗺️ Map T3E" : "🗺️ Map SFO";
  const simPax = airport === "SFO"
    ? [
        { id: "TX1",  name: "Siyao Fu",    plan: "Premium", note: "Offline初始 · 需登录" },
        { id: "TX2",  name: "David Kim",   plan: "Premium", note: "Moving · Tight" },
        { id: "FP1",  name: "Lucas Martin",plan: "Free",    note: "AI agent only" },
        { id: "FP5",  name: "Ivan Petrov", plan: "Free",    note: "Location Lost" },
      ]
    : [
        { id: "TX1",  name: "Siyao Fu",    plan: "Premium", note: "Offline初始" },
        { id: "TX2",  name: "Sophie Chen", plan: "Premium", note: "Normal · Moving" },
        { id: "P4",   name: "Raj Patel",   plan: "Free",    note: "AI agent only" },
        { id: "P13",  name: "Zara Williams", plan: "Free",  note: "AI agent only" },
      ];

  const mainStyle = { padding: 0, overflow: "hidden" as const, height: "calc(100vh - 56px)" };

  return (
    <div className="app">
      <TopBar
        search={search} onSearch={setSearch}
        title="Orienta · 航司后台"
        subtitle={airportLabel}
        searchPlaceholder={airport === "PEK" ? "搜索登机口（如 E21 / D06）…" : "搜索登机口（如 B3 / G13）…"}
        mapMode={mapMode}
        setMapMode={(m) => setMapModeByAirport(prev => ({ ...prev, [airport]: m }))}
        paused={paused} setPaused={setPaused}
        gateCount={gates.length} passengerCount={passengers.length}
        transferCount={passengers.length}
        transferUrgentCount={riskCounts.red + riskCounts.yellow}
        dataSource={airport === "PEK" ? "T3E/I→I" : "SFO/I→D"}
        userLabel={`${session.user.displayName} · ${session.user.org}`}
        onLogout={onLogout}
        onPaxClick={() => { setMapViewMode("all"); setSelectedPaxId(null); setOpenConvPaxId(null); setTab("map"); }}
        onUrgentClick={() => { setMapViewMode("urgent"); setSelectedPaxId(null); setOpenConvPaxId(null); setTab("map"); }}
        mapViewFilter={mapViewMode}
        extraRight={
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {/* Airport switcher */}
            <div style={{ display: "flex", gap: 2, background: "rgba(255,255,255,0.08)", borderRadius: 8, padding: 2 }}>
              {(["PEK", "SFO"] as Airport[]).map(ap => (
                <button key={ap} onClick={() => setAirport(ap)}
                  className={"btn" + (airport === ap ? " primary" : "")}
                  style={{ fontSize: 11, padding: "3px 10px", minWidth: 44 }}>
                  {ap}
                </button>
              ))}
            </div>
            <button className={"btn" + (tab === "dashboard" ? " primary" : "")} onClick={() => setTab("dashboard")} style={{ fontSize: 12 }}>📊 Dashboard</button>
            <button className={"btn" + (tab === "map" ? " primary" : "")} onClick={() => setTab("map")} style={{ fontSize: 12 }}>{mapLabel}</button>
            <span className={"pill " + (rtUp ? "ok" : "warn")} style={{ fontSize: 11 }}>{rtUp ? "WS ●" : "WS ○"}</span>
          </div>
        }
      />

      <div className="main" style={mainStyle}>
        <div style={{ display: tab === "dashboard" ? "block" : "none", padding: 16, overflow: "auto", height: "100%" }}>
          <DashboardTab
            airport={airport}
            passengers={passengersFilteredByGate}
            presence={presence}
            riskCounts={riskCounts}
            priorityList={priorityList.filter(p => passengersFilteredByGate.some(x => x.id === p.id))}
            chatHistory={chatHistory}
            search={search}
            onSelectPax={(id) => { setSelectedPaxId(id); setOpenConvPaxId(id); setMapViewMode("single"); setTab("map"); rtRef.current?.fetchHistory(id); }}
            onSendSms={sendSms}
            onRequestLocation={requestLocation}
            onOpenConversation={openConversation}
            gatesById={gatesById}
            flightsById={flightsById}
          />
        </div>

        <div style={{
          display: tab === "map" ? "grid" : "none",
          gridTemplateColumns: dockChat
            ? (openConvPaxId ? "1fr minmax(200px, 280px) minmax(240px, 340px)" : "1fr minmax(200px, 320px)")
            : "1fr minmax(180px, 280px)",
          height: "100%",
          minHeight: 0,
        }}>
          <MapView
            gates={gates}
            passengers={mapPassengers}
            selectedGateId={null}
            selectedPassengerId={selectedPaxId}
            onSelectGate={() => {}}
            onSelectPassenger={(id) => {
              const next = id === selectedPaxId ? null : id;
              setSelectedPaxId(next);
              setMapViewMode(next ? "single" : "all");
            }}
            onHoverPassenger={setHoverPaxId}
            hoverPassenger={hoverPax}
            mapMode={mapMode}
            onProviderChanged={() => {}}
            visible={tab === "map"}
            centerOverride={airport === "SFO" ? { lat: 37.6155, lng: -122.3866 } : undefined}
          />
          {/* ── Sidebar: fills height with flex layout ── */}
          <div className="sidebar" style={{ overflowY: "auto", display: "flex", flexDirection: "column", height: "100%" }}>
            {/* Passenger detail or placeholder */}
            {selectedPax ? (
              <PassengerCard
                passenger={selectedPax}
                gate={gatesById.get(selectedPax.gateId) || null}
                flight={flightsById.get(selectedPax.flightId) || null}
                onSendSms={(msg) => sendSms(selectedPax.id, msg)}
                onOpenChat={() => openConversation(selectedPax.id)}
                realtimeInfo={{ rtUp, online: !!presence[selectedPax.id], lastMessage: null }}
              />
            ) : (
              <div className="card">
                <h3>Transfer Control · {airport}</h3>
                <RiskBadges counts={riskCounts} />
                <div className="hr" />
                <div className="small">Click a passenger marker to view details.</div>
              </div>
            )}

            {/* Priority List */}
            <div className="card" style={{ marginTop: 10 }}>
              <h3 style={{ fontSize: 13 }}>🔴 Priority List</h3>
              {priorityList.length === 0 && <div className="small" style={{ opacity: 0.5 }}>No urgent passengers.</div>}
              {priorityList.map(p => (
                <button key={p.id} className="btn" onClick={() => { setSelectedPaxId(p.id); setOpenConvPaxId(p.id); setMapViewMode("single"); setTab("map"); rtRef.current?.fetchHistory(p.id); }}
                  style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, width: "100%" }}>
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: statusBadge(p.extStatus), display: "inline-block" }} />
                    <b style={{ fontSize: 12 }}>{p.name}</b>
                    <span className="small">({p.id})</span>
                  </span>
                  <span className="small">{extStatusLabel(p.extStatus as PaxExtStatus)}</span>
                </button>
              ))}
            </div>

            {/* Pax Simulator — flex-grows to fill remaining space */}
            <div className="card" style={{ fontSize: 12, marginTop: 10, flexGrow: 1 }}>
              <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>🧪 Pax Simulator</div>
              <div style={{ opacity: 0.7, marginBottom: 8, fontSize: 11 }}>
                Open passenger frontend. TX1 = <b>Siyao Fu</b>（初始离线，需在前端登录上线）。
              </div>
              {simPax.map(({ id, name, plan, note }) => (
                <div key={id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: presence[id] ? "#34c759" : "#636366", display: "inline-block" }} />
                      <span style={{ fontWeight: 600 }}>{name}</span>
                    </span>
                    <span className="small" style={{ marginLeft: 4, opacity: 0.6 }}>({id})</span>
                    <div className="small" style={{ color: plan === "Premium" ? "#0a84ff" : "#636366" }}>
                      {plan === "Premium" ? "💎" : "🤖"} {presence[id] ? "Online" : "Offline"} · {note}
                    </div>
                  </div>
                  <button
                    className="btn"
                    style={{ fontSize: 10, padding: "4px 10px", flexShrink: 0, marginLeft: 6 }}
                    onClick={() => {
                      setSelectedPaxId(id);
                      setOpenConvPaxId(id);
                      rtRef.current?.fetchHistory(id);
                      setTab("map");
                    }}>
                    Open ↗
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* ── Right-most: docked chat panel (desktop) ── */}
          {dockChat && openConvPaxId && (
            <div style={{ overflow: "hidden", height: "100%", minHeight: 0, padding: 10 }}>
              <ConversationPanel
                  mode="docked"
                  passengerId={openConvPaxId}
                  passenger={passengers.find(p => p.id === openConvPaxId) || null}
                  history={chatHistory[openConvPaxId] || []}
                  onSend={(body) => sendChat(openConvPaxId, body)}
                  onRequestLocation={() => requestLocation(openConvPaxId)}
                  onClose={() => setOpenConvPaxId(null)}
                  isOnline={!!presence[openConvPaxId]}
                  isPremium={passengers.find(p => p.id === openConvPaxId)?.plan === "premium"}
                />
            </div>
          )}
        </div>
      </div>

      {/* Mobile / narrow screens: keep floating chat overlay */}
      {openConvPaxId && !dockChat && (
        <ConversationPanel
          mode="floating"
          passengerId={openConvPaxId}
          passenger={passengers.find(p => p.id === openConvPaxId) || null}
          history={chatHistory[openConvPaxId] || []}
          onSend={(body) => sendChat(openConvPaxId, body)}
          onRequestLocation={() => requestLocation(openConvPaxId)}
          onClose={() => setOpenConvPaxId(null)}
          isOnline={!!presence[openConvPaxId]}
          isPremium={passengers.find(p => p.id === openConvPaxId)?.plan === "premium"}
        />
      )}

      <ToastHost items={toasts} onDismiss={(id) => setToasts(t => t.filter(x => x.id !== id))} />
    </div>
  );
}

// ─── DashboardTab ────────────────────────────────────────────────────────

function DashboardTab({
  airport, passengers, presence, riskCounts, priorityList, chatHistory,
  onSelectPax, onSendSms, onRequestLocation, onOpenConversation,
  gatesById, flightsById,
}: {
  airport: Airport;
  passengers: PassengerComputed[];
  presence: Record<string, boolean>;
  riskCounts: Record<string, number>;
  priorityList: PassengerComputed[];
  chatHistory: Record<string, ChatMessage[]>;
  onSelectPax(id: string): void;
  onSendSms(pid: string, msg: string): void;
  onRequestLocation(pid: string): void;
  onOpenConversation(pid: string): void;
  gatesById: Map<string, Gate>;
  flightsById: Map<string, Flight>;
}) {
  const [filter, setFilter] = useState<string>("all");

  const displayed = useMemo(() => {
    if (filter === "all") return passengers;
    if (filter === "lost") return passengers.filter(p => p.extStatus === "lost");
    if (filter === "urgent") return passengers.filter(p => p.transfer?.urgency === "urgent" || p.extStatus === "red");
    if (filter === "missed") return passengers.filter(p => p.extStatus === "missed");
    if (filter === "offline") return passengers.filter(p => p.extStatus === "offline");
    if (filter === "premium") return passengers.filter(p => p.plan === "premium");
    return passengers;
  }, [passengers, filter]);

  const extStatusOrder: Record<string, number> = { lost: 0, red: 1, yellow: 2, missed: 3, offline: 4, green: 5, gray: 6 };
  const sorted = [...displayed].sort((a, b) => (extStatusOrder[a.extStatus] ?? 9) - (extStatusOrder[b.extStatus] ?? 9));

  const airportTitle = airport === "PEK"
    ? "🔁 Transfer Control Dashboard — PEK T3E · International → International"
    : "🔁 Transfer Control Dashboard — SFO · International → Domestic";

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto" }}>
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{airportTitle}</span>
          <span className="small">{passengers.length} passengers</span>
        </h3>
        <RiskBadges counts={riskCounts} />
      </div>

      {priorityList.length > 0 && (
        <div className="card" style={{ marginBottom: 16, borderLeft: "3px solid #ff3b30" }}>
          <h3 style={{ fontSize: 13, color: "#ff3b30" }}>🚨 Requires Immediate Action</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {priorityList.map(p => {
              const gate = gatesById.get(p.gateId);
              const flight = flightsById.get(p.flightId);
              return (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", background: "rgba(255,59,48,0.08)", borderRadius: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: statusBadge(p.extStatus), flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{p.name}</span>
                    <span className="small" style={{ marginLeft: 6 }}>({p.id}) · {extStatusLabel(p.extStatus as PaxExtStatus)} · Gate {gate?.name || "?"} · {flight?.callsign || p.flightId}</span>
                    {p.transfer && <div className="small" style={{ opacity: 0.7 }}>{p.transfer.inboundFlight} {p.transfer.inboundFrom} → {p.flightId} {p.transfer.outboundTo}</div>}
                  </div>
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    <button className="btn" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => onOpenConversation(p.id)}>💬</button>
                    {p.extStatus === "lost" && <button className="btn" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => onRequestLocation(p.id)}>📍</button>}
                    <button className="btn primary" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => onSelectPax(p.id)}>View</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>All Passengers</h3>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["all", "lost", "urgent", "missed", "offline", "premium"].map(f => (
              <button key={f} className={"btn" + (filter === f ? " primary" : "")} style={{ fontSize: 11, padding: "3px 8px" }}
                onClick={() => setFilter(f)}>{f.charAt(0).toUpperCase() + f.slice(1)}</button>
            ))}
          </div>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ opacity: 0.5, textAlign: "left" }}>
              <th style={{ padding: "4px 6px" }}>Status</th>
              <th style={{ padding: "4px 6px" }}>ID</th>
              <th style={{ padding: "4px 6px" }}>Name</th>
              <th style={{ padding: "4px 6px" }}>Plan</th>
              <th style={{ padding: "4px 6px" }}>Inbound</th>
              <th style={{ padding: "4px 6px" }}>Outbound</th>
              <th style={{ padding: "4px 6px" }}>Gate</th>
              <th style={{ padding: "4px 6px" }}>ETA</th>
              <th style={{ padding: "4px 6px" }}>Online</th>
              <th style={{ padding: "4px 6px" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(p => {
              const gate = gatesById.get(p.gateId);
              const flight = flightsById.get(p.flightId);
              const isOnline = !!presence[p.id];
              const lastChat = (chatHistory[p.id] || []).slice(-1)[0];
              return (
                <tr key={p.id} style={{ borderTop: "1px solid rgba(255,255,255,0.05)", cursor: "pointer" }}
                  onClick={() => onSelectPax(p.id)}>
                  <td style={{ padding: "5px 6px" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: statusBadge(p.extStatus) }} />
                      <span style={{ fontSize: 10 }}>{extStatusLabel(p.extStatus as PaxExtStatus)}</span>
                    </span>
                  </td>
                  <td style={{ padding: "5px 6px", fontWeight: 700 }}>{p.id}</td>
                  <td style={{ padding: "5px 6px" }}>
                    {p.name}{p.needsWheelchair ? " ♿" : ""}{p.plan === "premium" ? " 💎" : ""}
                  </td>
                  <td style={{ padding: "5px 6px" }}>
                    <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: p.plan === "premium" ? "#0a84ff22" : "#ffffff11", color: p.plan === "premium" ? "#0a84ff" : "#fff" }}>
                      {p.plan === "premium" ? "Premium" : "Free"}
                    </span>
                  </td>
                  <td style={{ padding: "5px 6px" }}>
                    <div>{p.transfer.inboundFlight}</div>
                    <div style={{ opacity: 0.5, fontSize: 10 }}>{p.transfer.inboundFrom}</div>
                  </td>
                  <td style={{ padding: "5px 6px" }}>
                    <div>{flight?.callsign || p.flightId}</div>
                    <div style={{ opacity: 0.5, fontSize: 10 }}>{p.transfer.outboundTo}</div>
                  </td>
                  <td style={{ padding: "5px 6px" }}>{gate?.name || p.gateId}</td>
                  <td style={{ padding: "5px 6px" }}>{p.etaMinutes !== null ? `${p.etaMinutes}m` : "—"}</td>
                  <td style={{ padding: "5px 6px" }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: isOnline ? "#34c759" : "#636366", display: "inline-block" }} />
                  </td>
                  <td style={{ padding: "5px 6px" }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="btn" style={{ fontSize: 10, padding: "2px 6px" }}
                        onClick={() => onOpenConversation(p.id)}
                        title={lastChat ? `Last: ${lastChat.body.slice(0, 30)}` : "Open conversation"}>
                        💬{(chatHistory[p.id] || []).length > 0 ? ` ${(chatHistory[p.id] || []).length}` : ""}
                      </button>
                      {p.extStatus === "lost" && (
                        <button className="btn" style={{ fontSize: 10, padding: "2px 6px" }} onClick={() => onRequestLocation(p.id)}>📍</button>
                      )}
                      {(p.extStatus === "offline" || p.extStatus === "lost") && (
                        <button className="btn" style={{ fontSize: 10, padding: "2px 6px" }}
                          onClick={() => onSendSms(p.id, `Orienta: Your flight ${p.flightId} is at Gate ${gate?.name}. Please proceed immediately.`)}>
                          📨
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
