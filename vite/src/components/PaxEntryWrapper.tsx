import React, { useEffect, useMemo, useState } from "react";
import { resolveCanonicalPassengerId } from "../services/passengerAliases";
import { appendSpawnParams, parseSpawnFromQuery } from "../services/passengerSpawn";

function qs(name: string) {
  try { return new URL(location.href).searchParams.get(name); } catch { return null; }
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
 * 1) Show uploaded login HTML (public/pax-login.html)
 * 2) When user clicks "开始导航" or sends "其它" -> login page postMessage
 * 3) Load legacy passenger page (public/pax.html) inside same iframe (keeps /pax URL)
 */
export default function PaxEntryWrapper() {
  const pid = useMemo(() => {
    const raw = qs("pid") || qs("pax") || "TX1";
    return resolveCanonicalPassengerId(raw) || raw;
  }, []);
  const tenantId = useMemo(() => qs("tenant") || "airchina", []);

  const spawn = useMemo(() => parseSpawnFromQuery(qs), []);

  const direct = useMemo(() => qs("direct") === "1" || qs("skip") === "1", []);

  const [iframeSrc, setIframeSrc] = useState<string>(() => {
    if (direct) {
      const u = new URL("/pax.html", location.origin);
      u.searchParams.set("tenant", tenantId);
      u.searchParams.set("pax", pid);
      u.searchParams.set("plan", "premium");
      u.searchParams.set("name", "SIYAO FU");
      appendSpawnParams(u, spawn);
      return u.pathname + "?" + u.searchParams.toString();
    }
    const u = new URL("/pax-login.html", location.origin);
    u.searchParams.set("pid", pid);
    u.searchParams.set("tenant", tenantId);
    appendSpawnParams(u, spawn);
    return u.pathname + "?" + u.searchParams.toString();
  });

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

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#0b0b0c" }}>
      <iframe
        title="Passenger"
        src={iframeSrc}
        style={{ width: "100%", height: "100%", border: "none" }}
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
