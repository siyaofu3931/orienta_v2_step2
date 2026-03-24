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

function buildPaxFlightSrc(
  origin: string,
  tenantId: string,
  pid: string,
  plan: "free" | "premium",
  name: string,
  intent: "depart" | "arrive" | "transfer",
  payload: { flight?: string; arr?: string; dep?: string },
  spawn: ReturnType<typeof parseSpawnFromQuery>
) {
  const f = new URL("/pax-flight.html", origin);
  f.searchParams.set("tenant", tenantId);
  f.searchParams.set("pid", pid);
  f.searchParams.set("plan", plan);
  f.searchParams.set("name", name);
  f.searchParams.set("intent", intent);
  if (payload.flight) f.searchParams.set("flight", payload.flight);
  if (payload.arr) f.searchParams.set("arr", payload.arr);
  if (payload.dep) f.searchParams.set("dep", payload.dep);
  appendSpawnParams(f, spawn);
  return f.pathname + "?" + f.searchParams.toString();
}

function demoGatePairForPid(pid: string): { gateFrom: string; gateTo: string } {
  // gateFrom = arrival gate, gateTo = departure gate
  if (pid === "TX1") return { gateFrom: "E16", gateTo: "E19" };
  if (pid === "TX2") return { gateFrom: "E18", gateTo: "E19" };
  if (pid === "TX3") return { gateFrom: "E17", gateTo: "E19" };
  return { gateFrom: "E16", gateTo: "E19" };
}

function buildPaxDialogVideoSrc(
  origin: string,
  tenantId: string,
  pid: string,
  spawn: ReturnType<typeof parseSpawnFromQuery>
) {
  const u = new URL("/pax.html", origin);
  u.searchParams.set("tenant", tenantId);
  u.searchParams.set("pax", pid);
  u.searchParams.set("plan", "premium");
  if (tenantId === "airchina") u.searchParams.set("hub", "PEK");

  // Start on video tab immediately.
  u.searchParams.set("view", "video");

  const { gateFrom, gateTo } = demoGatePairForPid(pid);
  u.searchParams.set("gateFrom", gateFrom);
  u.searchParams.set("gateTo", gateTo);
  // Demo mode: avoid pausing the PEK video at intermediate gate checkpoints.
  // This keeps the back-office trajectory streaming so TX2/TX3 are visible.
  u.searchParams.set("autoGate", "1");

  appendSpawnParams(u, spawn);
  return u.pathname + "?" + u.searchParams.toString();
}

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

  // Demo QR passengers: always bypass login and go straight to pax.html (dialog + video).
  const isDemoQrPid = pid === "TX1" || pid === "TX2" || pid === "TX3";

  const spawn = useMemo(() => parseSpawnFromQuery(qs), []);
  const incomingName = useMemo(() => (qs("name") || "").trim(), []);
  const incomingPlanRaw = useMemo(() => (qs("plan") || "").trim().toLowerCase(), []);
  const incomingPlan = useMemo<"free" | "premium">(
    () => (incomingPlanRaw === "premium" || incomingPlanRaw === "paid" ? "premium" : "free"),
    [incomingPlanRaw]
  );
  const incomingIntent = useMemo(() => (qs("intent") || "").trim().toLowerCase(), []);
  const prefillFlight = useMemo(() => (qs("flight") || "").trim(), []);
  const prefillArr = useMemo(
    () => (qs("arr") || qs("arrival") || qs("arrivalFlight") || "").trim(),
    []
  );
  const prefillDep = useMemo(
    () => (qs("dep") || qs("departure") || qs("departureFlight") || "").trim(),
    []
  );

  /** Quick path: land on pax.html (chat + 视频) without login / 航班页 */
  const skipToPaxHtml = useMemo(
    () => qs("direct") === "1" || qs("skip") === "1" || qs("demo") === "1",
    []
  );
  /**
   * QR-prefilled demo path: QR already includes routing data.
   * We skip login and go directly to pax.html (dialog + video).
   */
  const skipToPaxDialogAndVideo = useMemo(
    () => isDemoQrPid,
    [isDemoQrPid]
  );

  const [iframeSrc, setIframeSrc] = useState<string>(() => {
    if (skipToPaxHtml) {
      return buildPaxHtmlSrc(location.origin, tenantId, pid, spawn);
    }
    if (skipToPaxDialogAndVideo) {
      return buildPaxDialogVideoSrc(location.origin, tenantId, pid, spawn);
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
        setIframeSrc(
          buildPaxFlightSrc(
            location.origin,
            tenantId,
            pid,
            plan,
            name,
            intent as "depart" | "arrive" | "transfer",
            { flight: payload.flight, arr: payload.arrivalFlight, dep: payload.departureFlight },
            spawn
          )
        );
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
      <iframe
        title="Passenger"
        src={iframeSrc}
        style={{ flex: 1, minHeight: 0, width: "100%", border: "none" }}
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
