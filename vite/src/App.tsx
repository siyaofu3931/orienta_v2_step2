import React, { useEffect, useMemo, useRef, useState } from "react";
import TopBar from "./components/TopBar";
import type { MapMode as TopBarMapMode } from "./components/TopBar";
import MapView from "./components/Map/MapView";
import PassengerCard from "./components/PassengerCard";
import ToastHost, { ToastItem } from "./components/Toast";
import LoginScreen from "./components/LoginScreen";
import ConversationPanel from "./components/ConversationPanel";
import PaxEntryWrapper from "./components/PaxEntryWrapper";
import { DeparturesFids, ArrivalsFids } from "./components/FidsPanel";

import type { Gate, Flight, LatLng, PassengerComputed, PaxExtStatus } from "./services/types";
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
  connectAdminRealtime, type MsgRecord, type MsgStatusEvent, type PresenceEvent, type ChatMessage, type PaxTrajectoryData,
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

  // Resizable sidebar width (persisted)
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 300;
    const v = localStorage.getItem("orienta_sidebar_width");
    const n = v ? parseInt(v, 10) : 300;
    return Number.isFinite(n) && n >= 200 && n <= 500 ? n : 300;
  });
  const resizeStartRef = useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const r = resizeStartRef.current;
      if (!r) return;
      const delta = e.clientX - r.startX;
      setSidebarWidth(w => {
        const next = Math.max(200, Math.min(500, r.startW + delta));
        localStorage.setItem("orienta_sidebar_width", String(next));
        return next;
      });
    };
    const onUp = () => { resizeStartRef.current = null; document.body.style.cursor = ""; document.body.style.userSelect = ""; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, []);

  const onResizeHandleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    resizeStartRef.current = { startX: e.clientX, startW: sidebarWidth };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

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
  const [paxTrajectories, setPaxTrajectories] = useState<Record<string, PaxTrajectoryData>>({});
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
    setPaxTrajectories({});
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
      onPaxTrajectory: (passengerId: string, data: PaxTrajectoryData) => {
        setPaxTrajectories(t => ({ ...t, [passengerId]: data }));
      },
    });
    rtRef.current = rt;
    return () => { rtRef.current = null; rt.close(); };
  }, [tenantId]);

  const passengers: PassengerComputed[] = useMemo(() => {
    if (!passengersRaw?.passengers) return [];
    const list = passengersRaw.passengers.map((p: any) => {
      const isOnline = !!presence[p.id];
      const trajectory = paxTrajectories[p.id];

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

      // When user is on PDR_AIRCHINA (or any client sending pax_trajectory), show current trajectory on map
      if (trajectory && trajectory.position) {
        (computed as any).location = trajectory.position as LatLng;
        (computed as any).activity = "moving";
        (computed as any).path = (trajectory.path?.length ? trajectory.path : [trajectory.position]) as LatLng[];
      }
      return computed;
    });

    // Always show Yan Jiang (TX3) first: remove any duplicate, then prepend one
    const withoutTX3 = list.filter((p: PassengerComputed) => p.id !== "TX3");
    const firstGate = gatesById.size > 0 ? Array.from(gatesById.values())[0] : null;
    const firstFlight = flightsById.size > 0 ? Array.from(flightsById.values())[0] : null;
    const gateId = firstGate?.id ?? "E22";
    const flightId = firstFlight?.id ?? "CA781";
    const loc = firstGate?.coordinate ?? { lat: 40.0742, lng: 116.6065 };
    const yanJiang: PassengerComputed = (() => {
      const fallbackP = {
        id: "TX3",
        name: "Yan Jiang",
        nationality: "CN",
        locale: "zh-CN",
        needsWheelchair: false,
        plan: "premium" as const,
        transfer: {
          direction: "intl_to_intl",
          urgency: "urgent",
          inboundFlight: "CA856",
          inboundFrom: "FRA",
          inboundArr: new Date(Date.now() - 70 * 60 * 1000).toISOString(),
          outboundFlight: flightId,
          outboundTo: "CDG",
          outboundDep: new Date(Date.now() + 25 * 60 * 1000).toISOString(),
          note: "At risk - Final Call flight, still dining",
        },
        flightId,
        gateId,
        activity: "dining" as const,
        location: loc,
        extStatus: "red" as PaxExtStatus,
        path: undefined,
        pathIndex: undefined,
        lastUpdateMs: Date.now(),
      };
      const gate = gatesById.get(gateId) || firstGate;
      const flight = flightsById.get(flightId) || firstFlight;
      const c = computePassenger(fallbackP as any, flight, gate);
      return { ...c, extStatus: "red" as PaxExtStatus };
    })();
    return [yanJiang, ...withoutTX3];
  }, [passengersRaw, gatesById, flightsById, presence, paxTrajectories]);

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

  const priorityList = useMemo(() => {
    const list = passengers
      .filter(p => ["lost", "red", "missed"].includes(p.extStatus) || p.transfer?.urgency === "urgent")
      .sort((a, b) => {
        const rank = (p: PassengerComputed) => {
          if (p.extStatus === "lost") return 0;
          if (p.extStatus === "red") return 1;
          if (p.transfer?.urgency === "urgent") return 2;
          if (p.extStatus === "missed") return 3;
          return 4;
        }
        const r = rank(a) - rank(b);
        if (r !== 0) return r;
        // Within same rank, put Yan Jiang (TX3) first
        return (a.id === "TX3" ? -1 : 0) - (b.id === "TX3" ? -1 : 0);
      })
      .slice(0, 12);
    return list;
  }, [passengers]);

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
        { id: "TX3",  name: "Yan Jiang",   plan: "Premium", note: "At Risk" },
        { id: "TX1",  name: "Siyao Fu",    plan: "Premium", note: "Offline初始 · 需登录" },
        { id: "TX2",  name: "David Kim",   plan: "Premium", note: "Moving · Tight" },
        { id: "FP1",  name: "Lucas Martin",plan: "Free",    note: "AI agent only" },
        { id: "FP5",  name: "Yan Jiang",   plan: "Premium", note: "Location Lost" },
      ]
    : [
        { id: "TX3",  name: "Yan Jiang",   plan: "Premium", note: "At Risk" },
        { id: "TX1",  name: "Siyao Fu",    plan: "Premium", note: "Offline初始" },
        { id: "TX2",  name: "Sophie Chen", plan: "Premium", note: "Normal · Moving" },
        { id: "P4",   name: "Raj Patel",   plan: "Free",    note: "AI agent only" },
        { id: "P13",  name: "Zara Williams", plan: "Free",  note: "AI agent only" },
      ];

  const mainStyle = { padding: 0, overflow: "hidden" as const, height: "calc(100vh - 56px)", display: "flex" as const, flexDirection: "column" as const };

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
        <div style={{
          display: tab === "dashboard" ? "flex" : "none",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          gap: 16,
          padding: 16,
          alignItems: "stretch",
        }}>
          {/* Left: Departures FIDS — fills left side */}
          <div style={{ flex: 1, minWidth: 220, maxWidth: 380, height: "100%", minHeight: 400 }}>
            <DeparturesFids airport={airport} />
          </div>
          {/* Center: Transfer Control Dashboard */}
          <div style={{ flex: 1.5, minWidth: 400, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column" }}>
          <DashboardTab
            airport={airport}
            passengers={passengersFilteredByGate}
            presence={presence}
            riskCounts={riskCounts}
            priorityList={priorityList.filter(p => passengersFilteredByGate.some(x => x.id === p.id))}
            chatHistory={chatHistory}
            onSelectPax={(id) => { setSelectedPaxId(id); setOpenConvPaxId(id); setMapViewMode("single"); setTab("map"); rtRef.current?.fetchHistory(id); }}
            onSendSms={sendSms}
            onRequestLocation={requestLocation}
            onOpenConversation={openConversation}
            gatesById={gatesById}
            flightsById={flightsById}
          />
          </div>
          {/* Right: Arrivals FIDS — fills right side */}
          <div style={{ flex: 1, minWidth: 220, maxWidth: 380, height: "100%", minHeight: 400 }}>
            <ArrivalsFids airport={airport} />
          </div>
        </div>

        <div style={{
          display: tab === "map" ? "flex" : "none",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}>
          <div style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column" }}>
          <MapView
            airport={airport}
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
          </div>
          {/* ── Resize handle ── */}
          <div
            onMouseDown={onResizeHandleMouseDown}
            style={{
              width: 6,
              flexShrink: 0,
              cursor: "col-resize",
              background: "rgba(255,255,255,0.06)",
              transition: "background 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(10,132,255,0.3)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
            title="Drag to resize"
          />
          {/* ── Sidebar: resizable width ── */}
          <div className="sidebar" style={{ width: sidebarWidth, flexShrink: 0, overflowY: "auto", display: "flex", flexDirection: "column", height: "100%" }}>
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
              <div className="card card-placeholder">
                <h3>Transfer Control · {airport}</h3>
                <RiskBadges counts={riskCounts} />
                <div className="hr" />
                <div className="small">Click a passenger marker to view details.</div>
              </div>
            )}

            {/* Priority List */}
            <div className="card card-priority" style={{ marginTop: 10 }}>
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
            <div className="card card-sim" style={{ fontSize: 12, marginTop: 10, flexGrow: 1 }}>
              <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>🧪 Pax Simulator</div>
              <div style={{ opacity: 0.7, marginBottom: 8, fontSize: 11 }}>
                Open passenger frontend. TX1 = <b>Siyao Fu</b>（初始离线，需在前端登录上线）。
              </div>
              {simPax.map(({ id, name, plan, note }) => (
                <div key={id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
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
            <div style={{ width: 320, flexShrink: 0, overflow: "hidden", height: "100%", minHeight: 0, padding: 10 }}>
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
    ? "Transfer Control Dashboard — PEK T3E · International → International"
    : "Transfer Control Dashboard — SFO · International → Domestic";

  const badgeItems = [
    { key: "green", label: "On Track", cls: "green" },
    { key: "yellow", label: "Tight", cls: "yellow" },
    { key: "red", label: "At Risk", cls: "red" },
    { key: "lost", label: "Lost", cls: "lost" },
    { key: "offline", label: "Offline", cls: "offline" },
    { key: "missed", label: "Missed", cls: "missed" },
  ] as const;

  return (
    <div className="transfer-control-dashboard">
      {/* Header */}
      <div className="tcd-header">
        <h2>
          <span>🔁 {airportTitle}</span>
          <span className="tcd-count">{passengers.length} passengers</span>
        </h2>
        <div className="tcd-badges">
          {badgeItems.map(({ key, label, cls }) => (
            <div key={key} className={`tcd-badge ${cls}`}>
              <span className="tcd-badge-num">{(riskCounts as Record<string, number>)[key] || 0}</span>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Requires Immediate Action */}
      {priorityList.length > 0 && (
        <div className="tcd-urgent">
          <h3>⚠️ Requires Immediate Action</h3>
          {priorityList.map(p => {
            const gate = gatesById.get(p.gateId);
            const flight = flightsById.get(p.flightId);
            const rowCls = p.extStatus === "red" ? "at-risk" : p.extStatus === "lost" ? "lost" : "missed";
            return (
              <div key={p.id} className={`tcd-urgent-row ${rowCls}`}>
                <span className="tcd-urgent-dot" style={{ background: statusBadge(p.extStatus) }} />
                <div className="tcd-urgent-info">
                  <div className="tcd-urgent-name">{p.name} <span style={{ fontWeight: 500, color: "var(--tcd-text-muted)" }}>({p.id})</span></div>
                  <div className="tcd-urgent-meta">{extStatusLabel(p.extStatus as PaxExtStatus)} · Gate {gate?.name || "?"} · {flight?.callsign || p.flightId}</div>
                  {p.transfer && <div className="tcd-urgent-route">{p.transfer.inboundFlight} {p.transfer.inboundFrom} → {p.flightId} {p.transfer.outboundTo}</div>}
                </div>
                <div className="tcd-urgent-actions">
                  <button className="tcd-action-btn" onClick={() => onOpenConversation(p.id)} title="Chat">💬</button>
                  {p.extStatus === "lost" && <button className="tcd-action-btn" onClick={() => onRequestLocation(p.id)} title="Request location">📍</button>}
                  <button className="tcd-action-btn primary" onClick={() => onSelectPax(p.id)}>View</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* All Passengers */}
      <div className="tcd-all">
        <div className="tcd-all-header">
          <h3>All Passengers</h3>
          <div className="tcd-filter-group">
            {["all", "lost", "urgent", "missed", "offline", "premium"].map(f => (
              <button key={f} className={`tcd-filter-btn ${filter === f ? "active" : ""}`}
                onClick={() => setFilter(f)}>{f.charAt(0).toUpperCase() + f.slice(1)}</button>
            ))}
          </div>
        </div>

        <div className="tcd-table-wrap">
          <table className="tcd-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>ID</th>
                <th>Name</th>
                <th>Plan</th>
                <th>Inbound</th>
                <th>Outbound</th>
                <th>Gate</th>
                <th>ETA</th>
                <th>Online</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(p => {
                const gate = gatesById.get(p.gateId);
                const flight = flightsById.get(p.flightId);
                const isOnline = !!presence[p.id];
                const statusCls = (p.extStatus as string) in { green: 1, yellow: 1, red: 1, lost: 1, offline: 1, missed: 1, gray: 1 } ? p.extStatus : "gray";
                return (
                  <tr key={p.id} onClick={() => onSelectPax(p.id)}>
                    <td>
                      <span className="tcd-status-cell">
                        <span className="tcd-status-dot" style={{ background: statusBadge(p.extStatus) }} />
                        <span className={`tcd-status-label ${statusCls}`}>{extStatusLabel(p.extStatus as PaxExtStatus)}</span>
                      </span>
                    </td>
                    <td className="tcd-id-cell">{p.id}</td>
                    <td>{p.name}{p.needsWheelchair ? " ♿" : ""}{p.plan === "premium" ? " 💎" : ""}</td>
                    <td>
                      <span className={`tcd-plan-tag ${p.plan === "premium" ? "premium" : "free"}`}>
                        {p.plan === "premium" ? "Premium" : "Free"}
                      </span>
                    </td>
                    <td>
                      <div>{p.transfer.inboundFlight}</div>
                      <div style={{ fontSize: 11, color: "var(--tcd-text-muted)" }}>{p.transfer.inboundFrom}</div>
                    </td>
                    <td>
                      <div>{flight?.callsign || p.flightId}</div>
                      <div style={{ fontSize: 11, color: "var(--tcd-text-muted)" }}>{p.transfer.outboundTo}</div>
                    </td>
                    <td>{gate?.name || p.gateId}</td>
                    <td>{p.etaMinutes !== null ? `${p.etaMinutes}m` : "—"}</td>
                    <td>
                      <span className={`tcd-online-dot ${isOnline ? "on" : "off"}`} />
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <div className="tcd-row-actions">
                        <button className="tcd-action-btn" onClick={() => onOpenConversation(p.id)} title="Chat">💬</button>
                        {p.extStatus === "lost" && <button className="tcd-action-btn" onClick={() => onRequestLocation(p.id)}>📍</button>}
                        {(p.extStatus === "offline" || p.extStatus === "lost") && (
                          <button className="tcd-action-btn" onClick={() => onSendSms(p.id, `Orienta: Your flight ${p.flightId} is at Gate ${gate?.name}. Please proceed immediately.`)}>📨</button>
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
    </div>
  );
}
