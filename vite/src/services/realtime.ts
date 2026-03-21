export type MsgStatus = "sent" | "delivered" | "ack";

export type MsgRecord = {
  messageId: string;
  tenantId: string;
  passengerId: string;
  title: string;
  body: string;
  createdAt: number;
  deliveredAt?: number;
  ackAt?: number;
  status: MsgStatus;
};

export type ChatKind = "text" | "location" | "system" | "ai_agent" | "operator";

export type ChatMsgStatus = "sending" | "sent" | "delivered" | "read";

export type ChatMessage = {
  id: string;
  passengerId: string;
  tenantId: string;
  from: "admin" | "pax" | "system" | "agent";
  kind: ChatKind;
  body: string;
  gateRef?: string;
  createdAt: number;
  status?: ChatMsgStatus;   // only for "from: admin" messages
  deliveredAt?: number;
  readAt?: number;
};

export type PresenceEvent = { tenantId: string; passengerId: string; online: boolean; at: number };
export type MsgStatusEvent = { tenantId: string; passengerId: string; messageId: string; status: MsgStatus; createdAt: number; deliveredAt?: number; ackAt?: number };

export type PaxTrajectoryData = { path: { lat: number; lng: number }[]; position: { lat: number; lng: number } };

function wsUrl() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws`;
}

function safeParse(s: string) {
  try { return JSON.parse(s); } catch { return null; }
}

export type AdminRealtime = {
  isConnected(): boolean;
  send(passengerId: string, body: string, title?: string, messageId?: string): string;
  chatSend(passengerId: string, body: string, kind?: ChatKind, gateRef?: string): void;
  requestLocation(passengerId: string): void;
  fetchHistory(passengerId: string): void;
  close(): void;
};

export function connectAdminRealtime(opts: {
  tenantId: string;
  onPresence?(e: PresenceEvent): void;
  onMsg?(r: MsgRecord): void;
  onStatus?(e: MsgStatusEvent): void;
  onChatMsg?(m: ChatMessage): void;
  onChatHistory?(passengerId: string, messages: ChatMessage[]): void;
  onChatRead?(passengerId: string, messageId: string, at: number): void;
  onPaxTrajectory?(passengerId: string, data: PaxTrajectoryData): void;
  onConnectionChange?(up: boolean): void;
}): AdminRealtime {
  const { tenantId } = opts;
  let connected = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: any = null;

  const connect = () => {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    ws = new WebSocket(wsUrl());
    ws.onopen = () => {
      connected = true;
      opts.onConnectionChange?.(true);
      ws?.send(JSON.stringify({ type: "hello", role: "admin", tenantId }));
    };
    ws.onclose = () => {
      connected = false;
      opts.onConnectionChange?.(false);
      reconnectTimer = setTimeout(connect, 1200);
    };
    ws.onerror = () => {};
    ws.onmessage = (ev) => {
      const m = safeParse(String(ev.data));
      if (!m || typeof m.type !== "string") return;
      if (m.type === "presence") opts.onPresence?.(m);
      if (m.type === "msg") opts.onMsg?.(m.record);
      if (m.type === "msg_status") opts.onStatus?.(m);
      if (m.type === "chat_msg") opts.onChatMsg?.(m.message);
      if (m.type === "chat_history") opts.onChatHistory?.(m.passengerId, m.messages);
      if (m.type === "chat_read") opts.onChatRead?.(m.passengerId, m.messageId, m.at);
      if (m.type === "pax_trajectory" && m.passengerId && m.position) {
        const pos = m.position;
        const lat = Number(pos.lat);
        const lng = Number(pos.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        const pathRaw = Array.isArray(m.path) ? m.path : [];
        const path = pathRaw.length
          ? pathRaw.map((pt: { lat?: unknown; lng?: unknown }) => ({
              lat: Number(pt.lat),
              lng: Number(pt.lng),
            })).filter((pt) => Number.isFinite(pt.lat) && Number.isFinite(pt.lng))
          : [];
        opts.onPaxTrajectory?.(m.passengerId, {
          path: path.length ? path : [{ lat, lng }],
          position: { lat, lng },
        });
      }
    };
  };

  connect();

  return {
    isConnected: () => connected,
    send: (passengerId, body, title, messageId) => {
      const id = messageId || `msg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "send", tenantId, passengerId, title, body, messageId: id }));
      }
      return id;
    },
    chatSend: (passengerId, body, kind = "text", gateRef) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "chat_send", tenantId, passengerId, body, kind, gateRef }));
      }
    },
    requestLocation: (passengerId) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "loc_request", tenantId, passengerId }));
      }
    },
    fetchHistory: (passengerId) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "chat_fetch", tenantId, passengerId }));
      }
    },
    close: () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      try { ws?.close(); } catch {}
      ws = null;
    },
  };
}

export type PaxRealtime = {
  isConnected(): boolean;
  ack(messageId: string): void;
  chatSend(body: string, kind?: ChatKind, gateRef?: string): void;
  markRead(messageId: string): void;
  close(): void;
};

export function connectPaxRealtime(opts: {
  tenantId: string;
  passengerId: string;
  onMessage?(r: MsgRecord): void;
  onAckOk?(messageId: string): void;
  onChatMsg?(m: ChatMessage): void;
  onChatHistory?(messages: ChatMessage[]): void;
  onMarkRead?(): void;
  onLocRequest?(): void;
  onConnectionChange?(up: boolean): void;
}): PaxRealtime {
  const { tenantId, passengerId } = opts;
  let connected = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: any = null;

  const connect = () => {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    ws = new WebSocket(wsUrl());
    ws.onopen = () => {
      connected = true;
      opts.onConnectionChange?.(true);
      ws?.send(JSON.stringify({ type: "hello", role: "pax", tenantId, passengerId }));
    };
    ws.onclose = () => {
      connected = false;
      opts.onConnectionChange?.(false);
      reconnectTimer = setTimeout(connect, 1200);
    };
    ws.onerror = () => {};
    ws.onmessage = (ev) => {
      const m = safeParse(String(ev.data));
      if (!m || typeof m.type !== "string") return;
      if (m.type === "message") opts.onMessage?.(m.record);
      if (m.type === "ack_ok") opts.onAckOk?.(m.messageId);
      if (m.type === "chat_msg") { opts.onChatMsg?.(m.message); opts.onMarkRead?.(); }
      if (m.type === "chat_history") opts.onChatHistory?.(m.messages);
      if (m.type === "loc_request") opts.onLocRequest?.();
    };
  };

  connect();

  return {
    isConnected: () => connected,
    ack: (messageId) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ack", tenantId, passengerId, messageId }));
      }
    },
    chatSend: (body, kind = "text", gateRef) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "chat_send", tenantId, passengerId, body, kind, gateRef }));
      }
    },
    markRead: (messageId: string) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "chat_read", tenantId, passengerId, messageId, at: Date.now() }));
      }
    },
    close: () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      try { ws?.close(); } catch {}
      ws = null;
    },
  };
}
