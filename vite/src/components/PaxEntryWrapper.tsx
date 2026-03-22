import React, { useEffect, useMemo, useState } from "react";
import { resolveCanonicalPassengerId } from "../services/passengerAliases";
import { appendSpawnParams, parseSpawnFromQuery } from "../services/passengerSpawn";

function qs(name: string) {
  try { return new URL(location.href).searchParams.get(name); } catch { return null; }
}

function buildPaxHtmlSrc(
  origin: string,
  tenantId: string,
  pid: string,
  spawn: ReturnType<typeof parseSpawnFromQuery>
) {
  const u = new URL("/pax.html", origin);
  u.searchParams.set("tenant", tenantId);
  u.searchParams.set("pax", pid);
  u.searchParams.set("plan", "premium");
  u.searchParams.set("name", "SIYAO FU");
  if (tenantId === "airchina") u.searchParams.set("hub", "PEK");
  appendSpawnParams(u, spawn);
  return u.pathname + "?" + u.searchParams.toString();
}

type EntryPayload = {
  mode?: "free" | "paid";
  type?: string; // depart|arrive|transfer|other
  flight?: string;
  arrivalFlight?: string;
  departureFlight?: string;
  message?: string;
  [k: string]: any;
};

/**
 * Route: /pax?pid=TX1&tenant=airchina (PEK) or tenant=airchina_sfo (SFO)
 * Lounge QR: /pax?pid=TX1&tenant=airchina&lounge=1 → fixed spawn on admin map (see passengerSpawn.ts)
 *
 * Default: pax-login →（出发/抵达/中转）→ pax-flight → 开始导航 → pax.html（对话 / 视频页）.
 * Skip straight to pax.html: ?direct=1 or ?skip=1 or ?demo=1
 */
export default function PaxEntryWrapper() {
  const pid = useMemo(() => {
    const raw = qs("pid") || qs("pax") || "TX1";
    return resolveCanonicalPassengerId(raw) || raw;
  }, []);
  const tenantId = useMemo(() => qs("tenant") || "airchina", []);

  const spawn = useMemo(() => parseSpawnFromQuery(qs), []);

  /** Quick path: land on pax.html (chat + 视频) without login / 航班页 */
  const skipToPaxHtml = useMemo(
    () => qs("direct") === "1" || qs("skip") === "1" || qs("demo") === "1",
    []
  );
  const startAtLogin = !skipToPaxHtml;

  const [iframeSrc, setIframeSrc] = useState<string>(() => {
    if (skipToPaxHtml) {
      return buildPaxHtmlSrc(location.origin, tenantId, pid, spawn);
    }
    const u = new URL("/pax-login.html", location.origin);
    u.searchParams.set("pid", pid);
    u.searchParams.set("tenant", tenantId);
    appendSpawnParams(u, spawn);
    return u.pathname + "?" + u.searchParams.toString();
  });

  useEffect(() => {
    document.title = skipToPaxHtml ? "Orienta · 旅客端（快捷预览）" : "Orienta · 旅客端";
  }, [skipToPaxHtml]);

  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      const data: any = ev.data;
      if (!data || data.type !== "orienta_entry") return;
      const payload: EntryPayload = data.payload || {};

      const plan = payload.mode === "paid" ? "premium" : "free";
      const name = plan === "premium" ? "SIYAO FU" : "Guest";

      const intent = (payload.type || "").toLowerCase();

      // Step 2: show flight results page first (FlightAware + Apple/OSM maps).
      // After user clicks "开始导航" in pax-flight.html, it will redirect to pax.html (chat).
      if (intent === "depart" || intent === "arrive" || intent === "transfer") {
        const f = new URL("/pax-flight.html", location.origin);
        f.searchParams.set("tenant", tenantId);
        f.searchParams.set("pid", pid);
        f.searchParams.set("plan", plan);
        f.searchParams.set("name", name);
        f.searchParams.set("intent", intent);
        if (payload.flight) f.searchParams.set("flight", payload.flight);
        if (payload.arrivalFlight) f.searchParams.set("arr", payload.arrivalFlight);
        if (payload.departureFlight) f.searchParams.set("dep", payload.departureFlight);
        appendSpawnParams(f, spawn);
        setIframeSrc(f.pathname + "?" + f.searchParams.toString());
        return;
      }

      const u = new URL("/pax.html", location.origin);
      u.searchParams.set("tenant", tenantId);
      u.searchParams.set("pax", pid);
      u.searchParams.set("plan", plan);
      u.searchParams.set("name", name);
      if (tenantId === "airchina") u.searchParams.set("hub", "PEK");

      if (payload.arrivalFlight) u.searchParams.set("arr", payload.arrivalFlight);
      if (payload.departureFlight) u.searchParams.set("dep", payload.departureFlight);
      if (payload.message) u.searchParams.set("q", payload.message);
      if (payload.flight) u.searchParams.set("flight", payload.flight);
      if (payload.type) u.searchParams.set("intent", payload.type);
      appendSpawnParams(u, spawn);

      setIframeSrc(u.pathname + "?" + u.searchParams.toString());
    }

    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [pid, tenantId, spawn]);

  /* Air China portal–style shell: light gray field + brand red accent (cf. airchina.com) */
  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background:
          "linear-gradient(180deg, #c8102e 0px, #c8102e 4px, transparent 4px), linear-gradient(180deg, #f5f6fa 0%, #e8ecf2 50%, #dde2ea 100%)",
      }}
    >
      <div
        style={{
          flexShrink: 0,
          padding: "9px 14px",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 0.2,
          color: "#2d2d2d",
          background: "rgba(255,255,255,0.92)",
          borderBottom: "1px solid rgba(200,16,46,0.18)",
          textAlign: "center",
          boxShadow: "0 1px 0 rgba(255,255,255,0.8)",
        }}
      >
        前端 Demo · 旅客端界面预览
        {startAtLogin
          ? "（完整流程：登录 → 航班信息 → 开始导航 → 对话 / 视频页）"
          : "（快捷预览：已跳过登录与航班页；去掉 ?direct=1 / ?demo=1 可恢复完整流程）"}
      </div>
      <iframe
        title="Passenger"
        src={iframeSrc}
        style={{ flex: 1, minHeight: 0, width: "100%", border: "none" }}
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
