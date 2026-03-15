import React, { useEffect, useRef, useState } from "react";
import type { PassengerComputed } from "../services/types";
import type { ChatMessage, ChatMsgStatus } from "../services/realtime";

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function StatusTick({ status }: { status?: ChatMsgStatus }) {
  if (!status) return null;
  // ✓ sending | ✓ sent | ✓✓ delivered | ✓✓blue read
  const map: Record<ChatMsgStatus, { icon: string; color: string; label: string }> = {
    sending: { icon: "◷",  color: "#8e8e93", label: "发送中" },
    sent:      { icon: "✓",  color: "#8e8e93", label: "已发送" },
    delivered: { icon: "✓✓", color: "#8e8e93", label: "已送达" },
    read:      { icon: "✓✓", color: "#0a84ff", label: "已读" },
  };
  const t = map[status];
  return (
    <span title={t.label} style={{ fontSize: 11, marginLeft: 4, color: t.color, fontWeight: 600 }}>
      {t.icon}
    </span>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isRight = msg.from === "admin" || msg.from === "agent";
  const bgMap: Record<string, string> = {
    admin:  "#0a84ff",
    pax:    "#ffffff",
    agent:  "#5856d6",
    system: "#fff7ed",
  };
  const colorMap: Record<string, string> = {
    admin:  "#ffffff",
    pax:    "#111827",
    agent:  "#ffffff",
    system: "#7c2d12",
  };
  const labelMap: Record<string, string> = {
    admin:  "Operator",
    pax:    "Passenger",
    agent:  "🤖 AI Agent",
    system: "⚙️ System",
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: isRight ? "flex-end" : "flex-start", marginBottom: 8 }}>
      <span style={{ fontSize: 10, color: "#6b7280", marginBottom: 2 }}>
        {labelMap[msg.from] || msg.from} · {formatTime(msg.createdAt)}
      </span>
      <div style={{
        maxWidth: "80%", padding: "8px 12px", borderRadius: 12,
        borderBottomRightRadius: isRight ? 3 : 12,
        borderBottomLeftRadius:  isRight ? 12 : 3,
        background: bgMap[msg.from] || "#333",
        color: colorMap[msg.from] || "#111827",
        border: msg.from === "pax" ? "1px solid rgba(0,0,0,0.06)" : undefined,
        fontSize: 13, lineHeight: 1.45, wordBreak: "break-word",
        fontStyle: msg.from === "system" ? "italic" : "normal",
      }}>
        {msg.kind === "location" && msg.gateRef && (
          <span style={{ background: "rgba(255,255,255,0.2)", borderRadius: 4, padding: "1px 5px", marginRight: 5, fontSize: 11 }}>
            📍 {msg.gateRef}
          </span>
        )}
        {msg.body}
      </div>
      {isRight && msg.from === "admin" && (
        <div style={{ display: "flex", alignItems: "center", marginTop: 2 }}>
          {msg.readAt && (
            <span style={{ fontSize: 10, color: "#636366", marginRight: 2 }}>
              {formatTime(msg.readAt)} 已读
            </span>
          )}
          <StatusTick status={msg.status} />
        </div>
      )}
    </div>
  );
}

export default function ConversationPanel({
  passengerId, passenger, history, onSend, onRequestLocation, onClose, isOnline, isPremium, mode = "floating"
}: {
  passengerId: string;
  passenger: PassengerComputed | null;
  history: ChatMessage[];
  onSend(body: string): void;
  onRequestLocation(): void;
  onClose(): void;
  isOnline: boolean;
  isPremium: boolean;
  mode?: "floating" | "docked";
}) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history.length]);

  const handleSend = () => {
    const t = input.trim();
    if (!t) return;
    onSend(t);
    setInput("");
  };

  const quickReplies = isPremium
    ? [
        "Please proceed to your gate immediately.",
        "I'm assigning a ground agent to assist you.",
        "Can you confirm your current location?",
        "Your transfer security is on Level 3.",
      ]
    : [
        "Location request sent.",
        "Please check the Orienta map for your route.",
      ];

  const shellStyle: React.CSSProperties = mode === "docked"
    ? {
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: 0,
        background: "#f2f2f7",
        borderRadius: 16,
        boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
        display: "flex",
        flexDirection: "column",
        border: "1px solid rgba(0,0,0,0.08)",
        overflow: "hidden",
      }
    : {
        position: "fixed",
        bottom: 24,
        right: 24,
        width: 380,
        maxHeight: 560,
        background: "#f2f2f7",
        borderRadius: 16,
        boxShadow: "0 8px 32px rgba(0,0,0,0.28)",
        display: "flex",
        flexDirection: "column",
        zIndex: 9000,
        border: "1px solid rgba(0,0,0,0.10)",
      };

  return (
    <div className="conversation-panel" style={{ ...shellStyle, color: "#111827" }}>
      {/* Header */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(0,0,0,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{passenger?.name || passengerId}</span>
          <span className="small" style={{ marginLeft: 6 }}>({passengerId})</span>
          {isPremium
            ? <span style={{ marginLeft: 6, fontSize: 10, color: "#0a84ff" }}>💎 Premium</span>
            : <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.5 }}>🤖 AI Only</span>}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: isOnline ? "#34c759" : "#636366" }} />
          <span style={{ fontSize: 11, color: "#6b7280" }}>{isOnline ? "Online" : "Offline"}</span>
          <button className="btn" onClick={onClose} style={{ fontSize: 13, padding: "2px 8px" }}>✕</button>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", minHeight: 200 }}>
        {history.length === 0 && (
          <div style={{ opacity: 0.4, fontSize: 12, textAlign: "center", marginTop: 20 }}>
            No messages yet.<br />
            {isPremium ? "Send a message as human operator." : "AI agent will auto-reply."}
          </div>
        )}
        {history.map(m => <MessageBubble key={m.id} msg={m} />)}
        <div ref={bottomRef} />
      </div>

      {/* Quick Actions */}
      <div style={{ padding: "6px 12px", display: "flex", gap: 6, flexWrap: "wrap", borderTop: "1px solid rgba(0,0,0,0.06)" }}>
        <button className="btn" style={{ fontSize: 10, padding: "2px 8px" }} onClick={onRequestLocation}>📍 Request Location</button>
        {passenger?.extStatus === "lost" && (
          <button className="btn" style={{ fontSize: 10, padding: "2px 8px", color: "#ff9f0a", borderColor: "#ff9f0a33" }}
            onClick={() => onSend("We've lost your location signal. Please tell us where you are (e.g., 'near Gate E21').")}>
            Ask Location
          </button>
        )}
        {isPremium && passenger?.transfer?.urgency === "urgent" && (
          <button className="btn" style={{ fontSize: 10, padding: "2px 8px", color: "#ff3b30", borderColor: "#ff3b3033" }}
            onClick={() => onSend("⚠️ URGENT: Please proceed directly to your gate NOW. Do not stop.")}>
            🚨 Urgent Alert
          </button>
        )}
      </div>

      {/* Input */}
      {isPremium ? (
        <div style={{ padding: "10px 12px", borderTop: "1px solid rgba(0,0,0,0.08)", display: "flex", gap: 8, flexDirection: "column" }}>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {quickReplies.map((q, i) => (
              <button key={i} className="btn" style={{ fontSize: 10, padding: "2px 7px" }}
                onClick={() => onSend(q)}>
                {q.slice(0, 28)}{q.length > 28 ? "…" : ""}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="Type message (operator)…"
              style={{ flex: 1, background: "#ffffff", border: "1px solid rgba(0,0,0,0.12)", borderRadius: 10, padding: "6px 10px", color: "#111827", fontSize: 13, resize: "none", height: 52 }}
            />
            <button className="btn primary" onClick={handleSend} style={{ alignSelf: "flex-end", padding: "8px 14px" }}>Send</button>
          </div>
        </div>
      ) : (
        <div style={{ padding: "10px 12px", borderTop: "1px solid rgba(0,0,0,0.08)" }}>
          <div style={{ fontSize: 11, opacity: 0.5, textAlign: "center" }}>
            Free user — AI agent auto-replies. View chat history only.
          </div>
        </div>
      )}
    </div>
  );
}
