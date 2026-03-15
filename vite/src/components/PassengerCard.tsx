import React, { useMemo, useState } from "react";
import type { Gate, Flight, PassengerComputed } from "../services/types";
import { defaultSmsTemplate } from "../services/passengerSim";
import type { MsgRecord } from "../services/realtime";

export default function PassengerCard(props: {
  passenger: PassengerComputed;
  gate: Gate | null;
  flight: Flight | null;
  onSendSms(msg: string): void;
  onOpenChat(): void;
  realtimeInfo?: {
    rtUp: boolean;
    online: boolean;
    lastMessage: MsgRecord | null;
  };
}) {
  const { passenger: p, gate, flight } = props;
  const [custom, setCustom] = useState("");
  const suggested = useMemo(() => defaultSmsTemplate(p, gate?.name || "—", flight?.id || p.flightId), [p, gate, flight]);

  const statusColor = { green: "#34c759", yellow: "#ffcc00", red: "#ff3b30", gray: "#8e8e93" }[p.status] || "#8e8e93";

  const extBadge = () => {
    if (p.extStatus === "missed") return { label: "❌ Missed", color: "#8e8e93" };
    if (p.extStatus === "offline") return { label: "📵 Offline", color: "#636366" };
    if (p.extStatus === "lost") return { label: "📍 Lost", color: "#ff9f0a" };
    if (p.extStatus === "red") return { label: "⛔ At Risk", color: "#ff3b30" };
    if (p.extStatus === "yellow") return { label: "⚠️ Tight", color: "#ffcc00" };
    if (p.extStatus === "green") return { label: "✅ On Track", color: "#34c759" };
    return { label: "—", color: "#8e8e93" };
  };
  const badge = extBadge();

  return (
    <div className="card card-pax">
      <h3 style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span>{p.name}</span>
        <span className="small">({p.id})</span>
        {p.needsWheelchair && <span className="small">♿</span>}
        {p.plan === "premium" && <span className="small" style={{ color: "#0a84ff" }}>💎 Premium</span>}
        <span style={{ color: badge.color, fontSize: 12, fontWeight: 600 }}>{badge.label}</span>
      </h3>

      <div className="row">
        <div className="kv">
          <div className="k">Nationality</div>
          <div className="v">{p.nationality} · {p.locale}</div>
        </div>
        <div className="kv">
          <div className="k">Plan</div>
          <div className="v">{p.plan === "premium" ? "💎 Premium" : "Free"}</div>
        </div>
      </div>

      <div className="row">
        <div className="kv">
          <div className="k">Inbound</div>
          <div className="v">{p.transfer.inboundFlight} ← {p.transfer.inboundFrom}</div>
        </div>
        <div className="kv">
          <div className="k">Outbound</div>
          <div className="v">{flight?.callsign || p.flightId} → {p.transfer.outboundTo}</div>
        </div>
      </div>

      <div className="row">
        <div className="kv">
          <div className="k">Gate</div>
          <div className="v" style={{ fontWeight: 700, fontSize: 18, color: "#34c759" }}>{gate?.name || p.gateId}</div>
        </div>
        <div className="kv">
          <div className="k">ETA</div>
          <div className="v" style={{ color: statusColor, fontWeight: 700 }}>
            {p.etaMinutes !== null ? `${p.etaMinutes} min` : "—"}
          </div>
        </div>
      </div>

      <div className="row">
        <div className="kv">
          <div className="k">Activity</div>
          <div className="v">{p.activity}</div>
        </div>
        <div className="kv">
          <div className="k">Online</div>
          <div className="v">
            <span className={"pill " + (props.realtimeInfo?.online ? "ok" : "warn")}>
              {props.realtimeInfo?.online ? "Online" : "Offline"}
            </span>
          </div>
        </div>
      </div>

      {p.transfer.note && (
        <div className="small" style={{ marginTop: 4, opacity: 0.6, fontStyle: "italic" }}>{p.transfer.note}</div>
      )}

      <div className="hr" />

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button className="btn primary" style={{ flex: 1 }} onClick={props.onOpenChat}>
          {p.plan === "premium" ? "💬 Open Chat (Operator)" : "🤖 View AI Chat"}
        </button>
      </div>

      <textarea
        className="input"
        style={{ width: "100%", resize: "vertical", minHeight: 64, marginBottom: 8, boxSizing: "border-box" }}
        value={custom || suggested}
        onChange={e => setCustom(e.target.value)}
        placeholder="Notification message…"
      />
      <button className="btn" style={{ width: "100%" }} onClick={() => props.onSendSms(custom || suggested)}>
        📨 Send Notification
      </button>
    </div>
  );
}
