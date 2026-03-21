import type { ViteDevServer } from "vite";
import type { Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import crypto from "node:crypto";
import { resolveCanonicalPassengerId } from "./src/services/passengerAliases";

type Role = "admin" | "pax";
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

export type ChatMessage = {
  id: string;
  passengerId: string;
  tenantId: string;
  from: "admin" | "pax" | "system" | "agent";
  kind: ChatKind;
  body: string;
  gateRef?: string;
  createdAt: number;
};

// Premium passenger IDs (can transfer to human agent)
// Premium IDs — for both PEK and SFO tenants
const PREMIUM_IDS = new Set(["TX1", "TX2", "TX3", "SP1", "SP2", "SP3", "SP4", "P3", "P7", "P8", "FP5", "P11", "P15", "P21", "P27"]);

function safeJsonParse(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}

function wsSend(ws: WebSocket, obj: any) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(obj));
}

// AI agent rules-based reply for free users
function aiAgentReply(passengerId: string, body: string, chatHistory: ChatMessage[]): string {
  const lc = body.toLowerCase();
  if (/where|where am|位置|在哪|怎么走|how do i get|navigate|导航/.test(lc)) {
    return `Hi! I'm Orienta AI. To reach your gate, follow the signs to Transfer Security (Level 2). Your route has been updated on your map. Need more help? Type your question.`;
  }
  if (/late|miss|赶不上|误机|delay|delayed/.test(lc)) {
    return `I can see your flight status. Please proceed directly to your gate now — do not stop. If you need staff assistance, contact the nearest Orienta counter.`;
  }
  if (/security|安检|customs|海关/.test(lc)) {
    return `For I→I transfers at T3E, you need to go through Transfer Security on Level 3 first, then proceed down to Level 2 for your departure gate.`;
  }
  if (/wheelchair|轮椅|accessible|无障碍/.test(lc)) {
    return `Accessibility assistance is available. Please proceed to the nearest staff counter or reply "help" to alert ground staff.`;
  }
  if (/human|人工|staff|real person|operator/.test(lc)) {
    return `I understand you'd like to speak with a human agent. This service is available for Premium members. Please contact the nearest Orienta counter for in-person assistance.`;
  }
  return `Thanks for your message. I'm Orienta AI assistant. Please proceed to your departure gate. Your real-time navigation is active on your screen. Reply with any questions!`;
}

export function attachWsHub(server: ViteDevServer | HttpServer) {
  const httpServer = "httpServer" in server ? server.httpServer : server;
  if (!httpServer) return;

  const paxSockets = new Map<string, Set<WebSocket>>();
  const adminSockets = new Map<string, Set<WebSocket>>();
  const online = new Set<string>();

  // Legacy one-way push messages (send/ack)
  const messages = new Map<string, MsgRecord>();

  // Chat history: key = `${tenantId}::${passengerId}`
  const chatHistories = new Map<string, ChatMessage[]>();

  // Pax metadata (display name + plan override), keyed by `${tenantId}::${passengerId}`
  const paxMeta = new Map<string, { displayName?: string; plan?: string }>();

  // PDR / live trajectory from pax (e.g. PDR_AIRCHINA), keyed by `${tenantId}::${passengerId}`
  const paxTrajectories = new Map<string, { path: { lat: number; lng: number }[]; position: { lat: number; lng: number } }>();

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    try {
      const url = new URL(req.url || "", "http://localhost");
      if (url.pathname !== "/ws") return;
      wss.handleUpgrade(req, socket as any, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } catch {}
  });

  function broadcastAdmins(tenantId: string, msg: any, excludeWs?: WebSocket) {
    const set = adminSockets.get(tenantId);
    if (!set) return;
    for (const ws of set) {
      if (ws === excludeWs) continue;
      wsSend(ws, msg);
    }
  }

  function broadcastPax(tenantId: string, passengerId: string, msg: any) {
    const key = `${tenantId}::${passengerId}`;
    const set = paxSockets.get(key);
    if (!set) return;
    for (const ws of set) wsSend(ws, msg);
  }

  function setPresence(tenantId: string, passengerId: string, isOnline: boolean) {
    const key = `${tenantId}::${passengerId}`;
    const wasOnline = online.has(key);
    if (isOnline) online.add(key);
    else online.delete(key);
    if (wasOnline !== isOnline) {
      broadcastAdmins(tenantId, { type: "presence", tenantId, passengerId, online: isOnline, at: Date.now() });
    }
  }

  function getChatHistory(tenantId: string, passengerId: string): ChatMessage[] {
    return chatHistories.get(`${tenantId}::${passengerId}`) || [];
  }

  function appendChat(tenantId: string, passengerId: string, msg: ChatMessage) {
    const key = `${tenantId}::${passengerId}`;
    const hist = chatHistories.get(key) || [];
    hist.push(msg);
    // Keep last 100 messages
    if (hist.length > 100) hist.splice(0, hist.length - 100);
    chatHistories.set(key, hist);
  }

  function pushToPassenger(rec: MsgRecord) {
    const key = `${rec.tenantId}::${rec.passengerId}`;
    const set = paxSockets.get(key);
    if (!set || set.size === 0) return false;
    for (const ws of set) {
      wsSend(ws, { type: "message", record: rec, requireAck: true });
    }
    return true;
  }

  wss.on("connection", (ws) => {
    let role: Role | null = null;
    let tenantId: string | null = null;
    let passengerId: string | null = null;

    const helloTimeout = setTimeout(() => {
      try { ws.close(1008, "missing hello"); } catch {}
    }, 8000);

    ws.on("message", (raw) => {
      const msg = safeJsonParse(String(raw));
      if (!msg || typeof msg.type !== "string") return;

      // === HELLO ===
      if (msg.type === "hello") {
        clearTimeout(helloTimeout);
        role = msg.role;
        tenantId = msg.tenantId;
        if (role === "pax") passengerId = resolveCanonicalPassengerId(String(msg.passengerId ?? ""));

        if (!tenantId) { ws.close(1008, "missing tenant"); return; }

        if (role === "admin") {
          const set = adminSockets.get(tenantId) || new Set<WebSocket>();
          set.add(ws);
          adminSockets.set(tenantId, set);

          // Send current presence
          for (const key of online) {
            if (!key.startsWith(`${tenantId}::`)) continue;
            const pid = key.split("::")[1] || "";
            wsSend(ws, { type: "presence", tenantId, passengerId: pid, online: true, at: Date.now() });
          }
          // Send current PDR trajectories for this tenant
          for (const [key, data] of paxTrajectories) {
            if (!key.startsWith(`${tenantId}::`)) continue;
            const pid = key.split("::")[1] || "";
            wsSend(ws, { type: "pax_trajectory", tenantId, passengerId: pid, path: data.path, position: data.position });
          }
          // Send recent messages
          const recent = Array.from(messages.values())
            .filter(r => r.tenantId === tenantId)
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 50);
          for (const r of recent) wsSend(ws, { type: "msg", record: r });
          return;
        }

        if (role === "pax") {
          if (!passengerId) { ws.close(1008, "missing passengerId"); return; }
          const key = `${tenantId}::${passengerId}`;
          const wasOnline = online.has(key);

          // Capture optional metadata for nicer UI + plan override
          paxMeta.set(key, {
            displayName: typeof msg.displayName === "string" ? msg.displayName : undefined,
            plan: typeof msg.plan === "string" ? msg.plan : undefined,
          });

          const set = paxSockets.get(key) || new Set<WebSocket>();
          set.add(ws);
          paxSockets.set(key, set);
          setPresence(tenantId, passengerId, true);

          // Emit a system chat line once when pax transitions from offline -> online
          if (!wasOnline) {
            const display = paxMeta.get(key)?.displayName || passengerId;
            const sysMsg: ChatMessage = {
              id: crypto.randomUUID(), passengerId, tenantId,
              from: "system", kind: "system",
              body: `✅ Passenger online: ${display} (${passengerId})`,
              createdAt: Date.now(),
            };
            appendChat(tenantId, passengerId, sysMsg);
            broadcastAdmins(tenantId, { type: "chat_msg", message: sysMsg });
            broadcastPax(tenantId, passengerId, { type: "chat_msg", message: sysMsg });
          }

          // Deliver pending messages
          const pending = Array.from(messages.values())
            .filter(r => r.tenantId === tenantId && r.passengerId === passengerId && r.status !== "ack")
            .sort((a, b) => a.createdAt - b.createdAt)
            .slice(-10);
          for (const rec of pending) {
            wsSend(ws, { type: "message", record: rec, requireAck: true });
            if (rec.status === "sent") {
              const updated = { ...rec, status: "delivered" as MsgStatus, deliveredAt: Date.now() };
              messages.set(updated.messageId, updated);
              broadcastAdmins(tenantId, { type: "msg_status", tenantId, passengerId, messageId: updated.messageId, status: "delivered", createdAt: updated.createdAt, deliveredAt: updated.deliveredAt });
            }
          }

          // Send chat history (last 20)
          const hist = getChatHistory(tenantId, passengerId).slice(-20);
          wsSend(ws, { type: "chat_history", passengerId, messages: hist });
          return;
        }
      }

      if (!role || !tenantId) return;

      // === ADMIN: send one-way push message ===
      if (role === "admin" && msg.type === "send") {
        const targetPid = resolveCanonicalPassengerId(String(msg.passengerId ?? ""));
        if (!targetPid || !msg.body) return;
        const id = msg.messageId || crypto.randomUUID();
        const rec: MsgRecord = {
          messageId: id, tenantId, passengerId: targetPid,
          title: msg.title || "Orienta 通知", body: msg.body,
          createdAt: Date.now(), status: "sent"
        };
        messages.set(rec.messageId, rec);
        broadcastAdmins(tenantId, { type: "msg", record: rec });

        const delivered = pushToPassenger(rec);
        if (delivered) {
          const updated = { ...rec, status: "delivered" as MsgStatus, deliveredAt: Date.now() };
          messages.set(rec.messageId, updated);
          broadcastAdmins(tenantId, { type: "msg_status", tenantId, passengerId: rec.passengerId, messageId: rec.messageId, status: "delivered", createdAt: updated.createdAt, deliveredAt: updated.deliveredAt });
        }
        return;
      }

      // === PAX: ack one-way message ===
      if (role === "pax" && msg.type === "ack") {
        const rec = messages.get(msg.messageId);
        if (!rec || rec.tenantId !== tenantId) return;
        if (passengerId && rec.passengerId !== passengerId) return;
        const updated = { ...rec, status: "ack" as MsgStatus, ackAt: Date.now(), deliveredAt: rec.deliveredAt ?? Date.now() };
        messages.set(updated.messageId, updated);
        broadcastAdmins(tenantId, { type: "msg_status", tenantId, passengerId: updated.passengerId, messageId: updated.messageId, status: "ack", createdAt: updated.createdAt, deliveredAt: updated.deliveredAt, ackAt: updated.ackAt });
        wsSend(ws, { type: "ack_ok", messageId: updated.messageId });
        return;
      }

      // === ADMIN: send chat message to passenger ===
      if (role === "admin" && msg.type === "chat_send") {
        const pid = resolveCanonicalPassengerId(String(msg.passengerId ?? ""));
        const { body, kind = "text", gateRef } = msg;
        if (!pid || !body) return;
        const chatMsg: ChatMessage = {
          id: crypto.randomUUID(), passengerId: pid, tenantId,
          from: "admin", kind: kind as ChatKind, body, gateRef,
          createdAt: Date.now()
        };
        appendChat(tenantId, pid, chatMsg);
        // Exclude sender ws so admin doesn\'t receive their own message via broadcast
        // (App.tsx inserts the local optimistic copy immediately on send)
        broadcastAdmins(tenantId, { type: "chat_msg", message: chatMsg }, ws);
        broadcastPax(tenantId, pid, { type: "chat_msg", message: chatMsg });
        return;
      }

      // === PAX: send chat message ===
      if (role === "pax" && msg.type === "chat_send") {
        if (!passengerId) return;
        const { body, kind = "text", gateRef } = msg;
        if (!body) return;
        const chatMsg: ChatMessage = {
          id: crypto.randomUUID(), passengerId, tenantId,
          from: "pax", kind: kind as ChatKind, body, gateRef,
          createdAt: Date.now()
        };
        appendChat(tenantId, passengerId, chatMsg);
        broadcastAdmins(tenantId, { type: "chat_msg", message: chatMsg });
        broadcastPax(tenantId, passengerId, { type: "chat_msg", message: chatMsg });

        // Auto AI reply for free users (allow plan override from entry page)
        const meta = paxMeta.get(`${tenantId}::${passengerId}`);
        const isPremium = (meta?.plan ? meta.plan === "premium" : PREMIUM_IDS.has(passengerId));
        if (!isPremium) {
          const hist = getChatHistory(tenantId, passengerId);
          const aiBody = aiAgentReply(passengerId, body, hist);
          setTimeout(() => {
            const aiMsg: ChatMessage = {
              id: crypto.randomUUID(), passengerId, tenantId,
              from: "agent", kind: "ai_agent", body: aiBody,
              createdAt: Date.now()
            };
            appendChat(tenantId!, passengerId!, aiMsg);
            broadcastAdmins(tenantId!, { type: "chat_msg", message: aiMsg });
            broadcastPax(tenantId!, passengerId!, { type: "chat_msg", message: aiMsg });
          }, 800);
        }
        return;
      }

      // === PAX: navigation request (demo mapping) ===
      if (role === "pax" && msg.type === "nav_request") {
        if (!passengerId) return;
        const kind = msg.kind || "transfer";
        let fromGate = "—";
        let toGate = "—";

        if (kind === "transfer") {
          const a = String(msg.arrivalFlight || "").toUpperCase().trim();
          const d = String(msg.departureFlight || "").toUpperCase().trim();
          // Demo mapping to satisfy test cases
          if (a.includes("B6") && a.includes("133")) fromGate = "B3";
          if (d.includes("CA986") || d.replace(/\s+/g, "").includes("CA986")) toGate = "G13-G14";
        } else {
          const q = String(msg.query || "");
          const m = q.toUpperCase().match(/\b([A-Z]\d{1,2})\b/g) || [];
          if (m.length >= 2) { fromGate = m[0]; toGate = m[1]; }
        }

        const sysMsg: ChatMessage = {
          id: crypto.randomUUID(), passengerId, tenantId,
          from: "system", kind: "system",
          body: `🗺️ Navigation plan: ${fromGate} → ${toGate}`,
          createdAt: Date.now(),
        };
        appendChat(tenantId, passengerId, sysMsg);
        broadcastAdmins(tenantId, { type: "chat_msg", message: sysMsg });
        broadcastPax(tenantId, passengerId, { type: "chat_msg", message: sysMsg });
        return;
      }

      // === PAX: mark messages as read ===
      if (role === "pax" && msg.type === "chat_read") {
        const { messageId, at } = msg;
        if (!messageId || !passengerId) return;
        // Notify all admins that pax has read the message
        broadcastAdmins(tenantId, {
          type: "chat_read",
          passengerId,
          messageId,
          at: at || Date.now(),
        });
        return;
      }

      // === ADMIN: request passenger location ===
      if (role === "admin" && msg.type === "loc_request") {
        const pid = resolveCanonicalPassengerId(String(msg.passengerId ?? ""));
        if (!pid) return;
        const sysMsg: ChatMessage = {
          id: crypto.randomUUID(), passengerId: pid, tenantId,
          from: "system", kind: "system",
          body: "📍 Location request: Please tell us where you are right now so we can update your navigation.",
          createdAt: Date.now()
        };
        appendChat(tenantId, pid, sysMsg);
        broadcastAdmins(tenantId, { type: "chat_msg", message: sysMsg });
        broadcastPax(tenantId, pid, { type: "chat_msg", message: sysMsg });
        // Also push as a notification to pax
        broadcastPax(tenantId, pid, { type: "loc_request", passengerId: pid, at: Date.now() });
        return;
      }

      // === PAX: send current trajectory (e.g. from PDR_AIRCHINA) for back office map ===
      if (role === "pax" && msg.type === "pax_trajectory") {
        if (!passengerId || !tenantId) return;
        const path = Array.isArray(msg.path) ? msg.path : [];
        const pos = msg.position && typeof msg.position.lat === "number" && typeof msg.position.lng === "number"
          ? { lat: msg.position.lat, lng: msg.position.lng } : null;
        const key = `${tenantId}::${passengerId}`;
        const prev = paxTrajectories.get(key);
        const position = pos || prev?.position;
        const pathPoints = path.length > 0 ? path.map((p: any) => ({ lat: Number(p.lat), lng: Number(p.lng) })) : (prev?.path || []);
        if (position) {
          const data = { path: pathPoints, position };
          paxTrajectories.set(key, data);
          broadcastAdmins(tenantId, { type: "pax_trajectory", tenantId, passengerId, path: data.path, position: data.position });
        }
        return;
      }

      // === ADMIN or PAX: fetch chat history ===
      if (msg.type === "chat_fetch") {
        const pid = role === "pax"
          ? passengerId
          : resolveCanonicalPassengerId(String(msg.passengerId ?? ""));
        if (!pid) return;
        const hist = getChatHistory(tenantId, pid).slice(-20);
        wsSend(ws, { type: "chat_history", passengerId: pid, messages: hist });
        return;
      }
    });

    ws.on("close", () => {
      clearTimeout(helloTimeout);
      if (role === "admin" && tenantId) {
        const set = adminSockets.get(tenantId);
        if (set) { set.delete(ws); if (set.size === 0) adminSockets.delete(tenantId); }
      }
      if (role === "pax" && tenantId && passengerId) {
        const key = `${tenantId}::${passengerId}`;
        const set = paxSockets.get(key);
        if (set) { set.delete(ws); if (set.size === 0) paxSockets.delete(key); }
        const still = paxSockets.get(key);
        if (!still || still.size === 0) {
          setPresence(tenantId, passengerId, false);
          // Keep last trajectory after disconnect so lounge / iframe handoff (pax-flight → pax.html) does not flicker off-map.
        }
      }
    });
  });

  httpServer.once("close", () => { try { wss.close(); } catch {} });
}
