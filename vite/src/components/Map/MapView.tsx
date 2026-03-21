import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Gate, PassengerComputed, LatLng } from "../../services/types";
import { T3E_SPINE_CENTER } from "../../services/passengerSim";
import { ROUTE_E15_TO_E19 } from "../../data/routeE15toE19";
import LeafletAdapter from "./leafletAdapter";
import MapKitAdapter from "./mapkitAdapter";

export type MapProvider = "apple" | "osm";
export type MapMode = "auto" | "apple" | "osm";

function statusColor(p: PassengerComputed) {
  const es = (p as any).extStatus;
  if (es === "missed")  return "#8e8e93";
  if (es === "offline") return "#636366";
  if (es === "lost")    return "#ff9f0a";
  if (p.status === "green")  return "#34c759";
  if (p.status === "yellow") return "#ffcc00";
  if (p.status === "red")    return "#ff3b30";
  return "#8e8e93";
}

// Detect if MapKit is configured by trying /api/mapkit/token
async function probeMapKit(): Promise<boolean> {
  try {
    const r = await fetch("/api/mapkit/token", { method: "HEAD" });
    return r.ok;
  } catch {
    return false;
  }
}

type Adapter = LeafletAdapter | MapKitAdapter;

export default function MapView(props: {
  gates: Gate[];
  passengers: PassengerComputed[];
  selectedGateId: string | null;
  selectedPassengerId: string | null;
  onSelectGate(id: string): void;
  onSelectPassenger(id: string): void;
  onHoverPassenger?(id: string | null): void;
  hoverPassenger?: PassengerComputed | null;
  mapMode: MapMode;
  onProviderChanged(p: MapProvider): void;
  visible?: boolean;
  centerOverride?: LatLng;
  /** When "PEK", E15→E19 static route is drawn. Omit or SFO = no static route. */
  airport?: "PEK" | "SFO";
}) {
  const { gates, passengers, selectedGateId, selectedPassengerId,
          onSelectGate, onSelectPassenger, mapMode } = props;

  const center = props.centerOverride ?? T3E_SPINE_CENTER;

  const containerRef = useRef<HTMLDivElement>(null);
  const adapterRef   = useRef<Adapter | null>(null);
  const [activeProvider, setActiveProvider] = useState<MapProvider>("osm");
  const [mapkitAvailable, setMapkitAvailable] = useState<boolean | null>(null); // null=checking

  const tracks = useMemo(() => passengers
    .filter(p => p.activity === "moving" && p.path && p.path.length > 1)
    .map(p => ({
      id: `trk_${p.id}`,
      passengerId: p.id,
      points: p.path!,
      color: statusColor(p),
    })), [passengers]);

  const staticRoutes = useMemo(() => {
    if (props.airport !== "PEK") return [];
    return [{ id: "e15-e19", points: ROUTE_E15_TO_E19, color: "#0a84ff" }];
  }, [props.airport]);

  const payload = useMemo(() => ({
    center,
    gates,
    passengers,
    tracks,
    staticRoutes,
    selectedGateId,
    selectedPassengerId,
  }), [center, gates, passengers, tracks, staticRoutes, selectedGateId, selectedPassengerId]);

  // Probe MapKit on mount
  useEffect(() => {
    probeMapKit().then(ok => setMapkitAvailable(ok));
  }, []);

  // Resolve effective provider
  const effectiveProvider: MapProvider = useMemo(() => {
    if (mapMode === "apple") return mapkitAvailable ? "apple" : "osm";
    if (mapMode === "osm")   return "osm";
    // auto: prefer apple if available
    return mapkitAvailable ? "apple" : "osm";
  }, [mapMode, mapkitAvailable]);

  // Re-mount adapter when provider changes
  useEffect(() => {
    if (!containerRef.current || mapkitAvailable === null) return;
    let destroyed = false;

    // Destroy old adapter
    if (adapterRef.current) {
      adapterRef.current.destroy();
      adapterRef.current = null;
    }

    const container = containerRef.current;
    setActiveProvider(effectiveProvider);
    props.onProviderChanged(effectiveProvider);

    if (effectiveProvider === "apple") {
      MapKitAdapter.create(container, {
        initialCenter: center,
        onSelectGate,
        onSelectPassenger,
        onHoverPassenger: props.onHoverPassenger ?? (() => {}),
      }).then(adapter => {
        if (destroyed) { adapter.destroy(); return; }
        // Update MapKit region to the requested center (PEK or SFO)
        try {
          const mk = (window as any).mapkit;
          if (mk) {
            const c = new mk.Coordinate(payload.center.lat, payload.center.lng);
            // Slightly larger span for SFO (covers terminals)
            const span = payload.center.lng < 0 ? new mk.CoordinateSpan(0.03, 0.05) : new mk.CoordinateSpan(0.012, 0.018);
            adapter["map"].region = new mk.CoordinateRegion(c, span);
          }
        } catch {}
        adapterRef.current = adapter;
        adapter.setData(payload);
      }).catch(err => {
        console.warn("MapKit failed, falling back to OSM:", err);
        setActiveProvider("osm");
        // Fallback to Leaflet
        if ((container as any)._leaflet_id) delete (container as any)._leaflet_id;
        LeafletAdapter.create(container, { initialCenter: center, onSelectGate, onSelectPassenger, onHoverPassenger: props.onHoverPassenger ?? (() => {}) })
          .then(a => { if (!destroyed) { adapterRef.current = a; a.setData(payload); } });
      });
    } else {
      if ((container as any)._leaflet_id) delete (container as any)._leaflet_id;
      LeafletAdapter.create(container, {
        initialCenter: center,
        onSelectGate,
        onSelectPassenger,
        onHoverPassenger: props.onHoverPassenger ?? (() => {}),
      }).then(adapter => {
        if (destroyed) { adapter.destroy(); return; }
        adapterRef.current = adapter;
        adapter.setData(payload);
      });
    }

    return () => {
      destroyed = true;
      adapterRef.current?.destroy();
      adapterRef.current = null;
    };
  }, [effectiveProvider, mapkitAvailable, center.lat, center.lng]); // eslint-disable-line

  // Update markers/routes on every sim tick — do not call invalidate() here (invalidate refits / was resetting zoom on each payload change).
  useEffect(() => {
    adapterRef.current?.setData(payload);
  }, [payload]);

  // When map tab becomes visible: Leaflet needs invalidateSize after display:none. Do not run on every payload tick.
  const mapTabWasVisibleRef = useRef(false);
  useEffect(() => {
    if (!props.visible) {
      mapTabWasVisibleRef.current = false;
      return;
    }
    const justShown = !mapTabWasVisibleRef.current;
    mapTabWasVisibleRef.current = true;
    if (!justShown) return;
    const runInv = () => {
      if (adapterRef.current instanceof LeafletAdapter) {
        (adapterRef.current as LeafletAdapter).invalidate();
      }
    };
    runInv();
    const tid = window.setTimeout(runInv, 120);
    return () => clearTimeout(tid);
  }, [props.visible]);

  return (
    <div className="orienta-map-frame" style={{ width: "100%", height: "100%", minHeight: 0, position: "relative" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%", minHeight: 0 }} />
      {mapkitAvailable === null && (
        <div style={{ position: "absolute", bottom: 8, left: 8, fontSize: 10, opacity: 0.5, pointerEvents: "none", zIndex: 10 }}>
          Checking map provider…
        </div>
      )}
    </div>
  );
}
