import type { Gate, PassengerComputed, LatLng } from "../../services/types";

declare global {
  interface Window {
    mapkit?: any;
  }
}

type CreateOptions = {
  initialCenter?: LatLng;
  onSelectGate(id: string): void;
  onSelectPassenger(id: string): void;
  onHoverPassenger?(id: string | null): void;
};

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(s);
  });
}

function toCoord(mapkit: any, p: LatLng) {
  return new mapkit.Coordinate(p.lat, p.lng);
}

function statusColor(p: PassengerComputed) {
  if (p.status === "green") return "#34c759";
  if (p.status === "yellow") return "#ffcc00";
  if (p.status === "red") return "#ff3b30";
  return "#9ca3af";
}

export default class MapKitAdapter {
  private mapkit: any;
  private map: any;
  private container: HTMLElement;

  private gateAnn = new Map<string, any>();
  // Passengers are rendered as an HTML overlay layer so we can support hover cards.
  private paxLayer: HTMLDivElement;
  private paxEls = new Map<string, HTMLDivElement>();
  private paxData = new Map<string, PassengerComputed>();
  private repositionTimer: any = null;
  private overlays: any[] = [];
  private lastCameraFollowPassengerId: string | null = null;
  private lastFollowLatLng: { lat: number; lng: number } | null = null;

  static async preload() {
    // Apple CDN - you can lock a version if desired
    const src = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js";
    await loadScript(src);
    if (!window.mapkit) throw new Error("MapKit JS not available after script load");
  }

  static async create(container: HTMLElement, opts: CreateOptions) {
    await MapKitAdapter.preload();
    const mapkit = window.mapkit!;
    // Init with authorizationCallback (fetch token from dev middleware / backend)
    mapkit.init({
      authorizationCallback: (done: (token: string) => void) => {
        fetch("/api/mapkit/token")
          .then((r) => r.text())
          .then((t) => done(t))
          .catch((e) => {
            console.error("MapKit token error", e);
          });
      }
    });

    const map = new mapkit.Map(container);

    // Default center: T3E centroid; allow override (e.g., SFO)
    const c0 = opts.initialCenter || { lat: 40.0748162, lng: 116.6061088 };
    const center = new mapkit.Coordinate(c0.lat, c0.lng);
    const span = c0.lng < 0 ? new mapkit.CoordinateSpan(0.03, 0.05) : new mapkit.CoordinateSpan(0.012, 0.018);
    map.region = new mapkit.CoordinateRegion(center, span);
    map.showsZoomControl = true;

    const inst = new MapKitAdapter(mapkit, map, container, opts);
    return inst;
  }

  constructor(mapkit: any, map: any, container: HTMLElement, private opts: CreateOptions) {
    this.mapkit = mapkit;
    this.map = map;
    this.container = container;

    // Ensure the container is a positioning context for our HTML overlays.
    try {
      const cs = window.getComputedStyle(this.container);
      if (!cs.position || cs.position === "static") this.container.style.position = "relative";
    } catch {}

    this.paxLayer = document.createElement("div");
    this.paxLayer.style.position = "absolute";
    this.paxLayer.style.inset = "0";
    this.paxLayer.style.pointerEvents = "none";
    this.paxLayer.style.zIndex = "20";
    this.container.appendChild(this.paxLayer);

    // Reposition on an interval to keep overlay markers aligned during pan/zoom.
    this.repositionTimer = window.setInterval(() => this.repositionPassengers(), 140);
  }

  destroy() {
    // remove annotations/overlays
    try {
      const anns = Array.from(this.gateAnn.values());
      if (anns.length) {
        if (typeof (this.map as any).removeAnnotations === "function") (this.map as any).removeAnnotations(anns);
        else if (typeof (this.map as any).removeAnnotation === "function") anns.forEach(a => (this.map as any).removeAnnotation(a));
      }
    } catch {}
    try {
      this.overlays.forEach((o) => {
        if (typeof (this.map as any).removeOverlay === "function") (this.map as any).removeOverlay(o);
        else if (typeof (this.map as any).removeOverlays === "function") (this.map as any).removeOverlays([o]);
      });
    } catch {}
    this.gateAnn.clear();
    this.paxEls.forEach((el) => el.remove());
    this.paxEls.clear();
    this.paxData.clear();
    try { this.paxLayer.remove(); } catch {}
    if (this.repositionTimer) {
      clearInterval(this.repositionTimer);
      this.repositionTimer = null;
    }
    this.overlays = [];
  }

  private paxTitle(p: PassengerComputed) {
    const online = (p as any).rtOnline ? "Online" : "Offline";
    const act =
      p.activity === "moving" ? "在路上" :
      p.activity === "shopping" ? "购物区" :
      p.activity === "dining" ? "餐饮区" :
      p.activity === "idle" ? "停留" :
      p.activity === "at_gate" ? "已到登机口" : "已登机";
    const xfer = p.transfer ? ` · 中转(${p.transfer.urgency === "urgent" ? "紧急" : "正常"})` : "";
    const pri = p.plan === "premium" ? " · Premium" : "";
    const wc = p.needsWheelchair ? " · ♿" : "";
    return `${p.name} (${p.id}) · ${online} · ${act} · ${p.nationality}${pri}${wc}${xfer}`;
  }

  private renderPaxEl(el: HTMLDivElement, p: PassengerComputed) {
    const color = statusColor(p);
    const bubble = (p as any).plan === "premium" ? `<div style="position:absolute;top:-10px;right:-10px;font-size:14px;filter: drop-shadow(0 6px 10px rgba(0,0,0,0.25));">💬</div>` : "";
    const wc = p.needsWheelchair ? `<div style="position:absolute;top:-10px;left:-10px;font-size:14px;filter: drop-shadow(0 6px 10px rgba(0,0,0,0.25));">♿</div>` : "";
    const xfer = p.transfer ? `<div style="position:absolute;bottom:-10px;left:-10px;font-size:12px;padding:2px 5px;border-radius:10px;background:rgba(255,255,255,0.92);border:1px solid rgba(0,0,0,0.12);font-weight:900;">T</div>` : "";
    const urg = p.transfer?.urgency === "urgent" ? `<div style="position:absolute;bottom:-10px;right:-10px;font-size:12px;padding:2px 6px;border-radius:10px;background:rgba(255,59,48,0.95);color:white;border:1px solid rgba(255,255,255,0.6);font-weight:900;">!</div>` : "";
    const ring = p.transfer?.urgency === "urgent" ? `<div style="position:absolute;inset:-6px;border-radius:999px;border:2px solid rgba(255,59,48,0.55);box-shadow:0 0 0 6px rgba(255,59,48,0.12);"></div>` : "";

    el.innerHTML = `
      <div style="position:relative;width:22px;height:22px;">
        ${ring}
        ${wc}
        ${bubble}
        ${xfer}
        ${urg}
        <div style="
          position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
          width:16px;height:16px;border-radius:999px;
          background:${color};
          border:2px solid rgba(255,255,255,0.95);
          box-shadow:0 10px 22px rgba(0,0,0,0.18);
        "></div>
      </div>
    `;
    el.title = this.paxTitle(p);
  }

  private repositionPassengers() {
    const hasOnPage = typeof (this.map as any).convertCoordinateToPointOnPage === "function";
    const convert = hasOnPage
      ? (this.map as any).convertCoordinateToPointOnPage
      : (this.map as any).convertCoordinateToPoint;
    if (!convert) return;

    const rect = this.container.getBoundingClientRect();

    for (const [id, p] of this.paxData) {
      const el = this.paxEls.get(id);
      if (!el) continue;
      const coord = toCoord(this.mapkit, p.location);
      let pt: any;
      try {
        pt = convert.call(this.map, coord);
      } catch {
        continue;
      }

      // convertCoordinateToPointOnPage returns page coords; convertCoordinateToPoint returns coords in the map view.
      const x = hasOnPage ? (pt.x - rect.left) : pt.x;
      const y = hasOnPage ? (pt.y - rect.top) : pt.y;
      const inView = x >= -40 && y >= -40 && x <= rect.width + 40 && y <= rect.height + 40;
      el.style.display = inView ? "block" : "none";
      el.style.left = "0px";
      el.style.top = "0px";
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    }
  }

  setData(data: {
    center: LatLng;
    gates: Gate[];
    passengers: PassengerComputed[];
    tracks: { id: string; passengerId: string; points: LatLng[]; color: string }[];
    staticRoutes?: { id: string; points: LatLng[]; color?: string }[];
    selectedGateId: string | null;
    selectedPassengerId: string | null;
  }) {
    const { gates, passengers, tracks, staticRoutes = [], selectedPassengerId } = data;

    // --- Gates
    const keepGate = new Set(gates.map((g) => g.id));
    for (const [id, ann] of this.gateAnn) {
      if (!keepGate.has(id)) {
        if (typeof (this.map as any).removeAnnotations === "function") (this.map as any).removeAnnotations([ann]);
        else if (typeof (this.map as any).removeAnnotation === "function") (this.map as any).removeAnnotation(ann);
        this.gateAnn.delete(id);
      }
    }

    for (const g of gates) {
      const existing = this.gateAnn.get(g.id);
      if (existing) {
        existing.coordinate = toCoord(this.mapkit, g.coordinate);
        existing.title = `Gate ${g.name}`;
        continue;
      }
      const ann = new this.mapkit.MarkerAnnotation(toCoord(this.mapkit, g.coordinate), {
        color: "#0a84ff",
        title: `Gate ${g.name}`,
        glyphText: g.name.replace(/[^0-9A-Za-z]/g, "").slice(-2) || "G"
      });
      (ann as any).data = { kind: "gate", id: g.id };
      ann.addEventListener("select", () => this.opts.onSelectGate(g.id));
      this.gateAnn.set(g.id, ann);
      if (typeof (this.map as any).addAnnotation === "function") (this.map as any).addAnnotation(ann);
      else if (typeof (this.map as any).addAnnotations === "function") (this.map as any).addAnnotations([ann]);
    }

    // --- Passengers (HTML overlay)
    const keepP = new Set(passengers.map((p) => p.id));
    for (const [id, el] of this.paxEls) {
      if (!keepP.has(id)) {
        el.remove();
        this.paxEls.delete(id);
        this.paxData.delete(id);
      }
    }

    for (const p of passengers) {
      this.paxData.set(p.id, p);
      const existing = this.paxEls.get(p.id);
      if (existing) {
        this.renderPaxEl(existing, p);
        continue;
      }
      const el = document.createElement("div");
      el.style.position = "absolute";
      el.style.pointerEvents = "auto";
      el.style.cursor = "pointer";
      el.dataset.pid = p.id;
      this.renderPaxEl(el, p);

      el.addEventListener("mouseenter", () => this.opts.onHoverPassenger?.(p.id));
      el.addEventListener("mouseleave", () => this.opts.onHoverPassenger?.(null));
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        this.opts.onSelectPassenger(p.id);
      });

      this.paxEls.set(p.id, el);
      this.paxLayer.appendChild(el);
    }

    // Ensure overlay positions are correct immediately
    this.repositionPassengers();

    // --- Tracks (overlays) - rebuild
    try {
      this.overlays.forEach((o) => {
        if (typeof (this.map as any).removeOverlay === "function") (this.map as any).removeOverlay(o);
        else if (typeof (this.map as any).removeOverlays === "function") (this.map as any).removeOverlays([o]);
      });
    } catch {}
    this.overlays = [];

    for (const r of staticRoutes) {
      if (r.points.length < 2) continue;
      const coords = r.points.map((pt) => toCoord(this.mapkit, pt));
      const color = r.color ?? "#0a84ff";
      const style = new this.mapkit.Style({ lineWidth: 5, lineJoin: "round", strokeColor: color });
      const pl = new this.mapkit.PolylineOverlay(coords, { style });
      if (typeof (this.map as any).addOverlay === "function") (this.map as any).addOverlay(pl);
      else if (typeof (this.map as any).addOverlays === "function") (this.map as any).addOverlays([pl]);
      this.overlays.push(pl);
    }

    for (const t of tracks) {
      const coords = t.points.map((pt) => toCoord(this.mapkit, pt));
      const style = new this.mapkit.Style({ lineWidth: 3, lineJoin: "round", strokeColor: t.color });
      const pl = new this.mapkit.PolylineOverlay(coords, { style });
      if (typeof (this.map as any).addOverlay === "function") (this.map as any).addOverlay(pl);
      else if (typeof (this.map as any).addOverlays === "function") (this.map as any).addOverlays([pl]);
      this.overlays.push(pl);
    }

    if (selectedPassengerId) {
      const pax = passengers.find((p) => p.id === selectedPassengerId);
      if (pax) {
        const center = toCoord(this.mapkit, pax.location);
        const span = new this.mapkit.CoordinateSpan(0.004, 0.006);
        const region = new this.mapkit.CoordinateRegion(center, span);
        const isNewSelection = selectedPassengerId !== this.lastCameraFollowPassengerId;
        const prev = this.lastFollowLatLng;
        const moved =
          prev &&
          (Math.abs(prev.lat - pax.location.lat) > 2e-5 ||
            Math.abs(prev.lng - pax.location.lng) > 2e-5);
        if (isNewSelection || moved) {
          try {
            if (typeof (this.map as any).setRegionAnimated === "function") {
              (this.map as any).setRegionAnimated(region, true);
            } else {
              this.map.region = region;
            }
          } catch {}
          this.lastFollowLatLng = { lat: pax.location.lat, lng: pax.location.lng };
        }
        this.lastCameraFollowPassengerId = selectedPassengerId;
      }
    } else {
      this.lastCameraFollowPassengerId = null;
      this.lastFollowLatLng = null;
    }
  }
}
