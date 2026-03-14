import React, { useEffect, useMemo, useRef, useState } from "react";
import type { PassengerComputed } from "../services/types";
import { agentReply } from "../services/passengerSim";

type Msg = { id: string; role: "me" | "agent"; text: string; ts: number };

export default function ChatDrawer(props: {
  open: boolean;
  onClose(): void;
  passenger: PassengerComputed | null;
  gateName: string;
  flightId: string;
}) {
  const { open, passenger, gateName, flightId } = props;
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    if (!passenger) return;
    const wc = passenger.needsWheelchair ? " ♿（轮椅/无障碍）" : "";
    const lang = passenger.locale?.startsWith("en") ? "English" : passenger.locale?.startsWith("zh") ? "中文" : passenger.locale || "";
    setMsgs([
      { id: "a1", role: "agent", text: `您好，我是 Orìenta 增值服务助手。已识别您为付费旅客，可提供导航与转人工支持。${wc} 语言偏好：${lang}。当前登机口：${gateName}（航班 ${flightId}）。`, ts: Date.now() }
    ]);
    setInput("");
  }, [open, passenger?.id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length]);

  const title = passenger ? `${passenger.name}${passenger.needsWheelchair ? " ♿" : ""} · 💬 增值服务` : "聊天";

  const send = () => {
    const t = input.trim();
    if (!t || !passenger) return;
    const me: Msg = { id: `m_${Date.now()}`, role: "me", text: t, ts: Date.now() };
    const reply: Msg = {
      id: `a_${Date.now() + 1}`,
      role: "agent",
      text: agentReply(passenger, gateName, flightId, t),
      ts: Date.now() + 1
    };
    setMsgs((m) => [...m, me, reply]);
    setInput("");
  };

  if (!open) return null;

  return (
    <div className="drawer" role="dialog" aria-modal="true">
      <div className="drawerHeader">
        <div style={{ fontWeight: 800 }}>{title}</div>
        <button className="btn" onClick={props.onClose}>关闭</button>
      </div>
      <div className="drawerBody">
        {msgs.map((m) => (
          <div key={m.id} className={"msg " + (m.role === "me" ? "me" : "")}>
            {m.text}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="drawerFooter">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入消息（如：导航 / 转人工 / 我在餐饮区）"
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
        />
        <button className="btn primary" onClick={send}>发送</button>
      </div>
    </div>
  );
}
