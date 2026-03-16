import L from "leaflet";
import type { Gate, PassengerComputed, LatLng } from "../../services/types";

type CreateOptions = {
  initialCenter?: LatLng;
  onSelectGate(id: string): void;
  onSelectPassenger(id: string): void;
  onHoverPassenger?(id: string | null): void;
};

// Default center (PEK T3E spine center). For SFO we pass an override.
const DEFAULT_CENTER: [number, number] = [40.0748162, 116.6061088]; // OSM centroid

function extStatus(p: PassengerComputed): string {
  return (p as any).extStatus || "green";
}

function statusColor(p: PassengerComputed): string {
  const es = extStatus(p);
  if (es === "missed")  return "#8e8e93";
  if (es === "offline") return "#636366";
  if (es === "lost")    return "#ff9f0a";
  if (p.status === "green")  return "#34c759";
  if (p.status === "yellow") return "#ffcc00";
  if (p.status === "red")    return "#ff3b30";
  return "#9ca3af";
}

function gateIcon(label: string) {
  return L.divIcon({
    className: "orienta-gate-marker",
    html: `<div style="min-width:28px;height:24px;border-radius:6px;
      background:linear-gradient(135deg,#0a84ff 0%,#0051d5 100%);color:white;
      display:flex;align-items:center;justify-content:center;
      font-weight:800;font-size:11px;padding:0 5px;
      box-shadow:0 0 12px rgba(10,132,255,0.6),0 2px 8px rgba(0,0,0,0.4);
      border:2px solid rgba(255,255,255,0.9);
      white-space:nowrap;">${label}</div>`,
    iconSize: [32, 24],
    iconAnchor: [16, 12],
  });
}

function paxIcon(p: PassengerComputed) {
  const color = statusColor(p);
  const es = extStatus(p);
  const showQ = ["lost", "missed", "offline"].includes(es);
  const urgent = p.transfer?.urgency === "urgent" && !showQ;
  const premium = p.plan === "premium";
  const wc = p.needsWheelchair;
  const badge = showQ
    ? `<div style="position:absolute;top:-5px;right:-5px;width:11px;height:11px;border-radius:50%;
        background:${es === "lost" ? "#ff9f0a" : "#636366"};color:#fff;
        font-size:8px;font-weight:900;display:flex;align-items:center;justify-content:center;">?</div>`
    : urgent
    ? `<div style="position:absolute;top:-5px;right:-5px;width:11px;height:11px;border-radius:50%;
        background:#ff3b30;color:#fff;font-size:8px;font-weight:900;
        display:flex;align-items:center;justify-content:center;">!</div>`
    : "";
  const premBadge = premium
    ? `<div style="position:absolute;top:-6px;left:-6px;font-size:10px;line-height:1;">💎</div>` : "";
  const wcBadge = wc
    ? `<div style="position:absolute;bottom:-6px;left:-6px;font-size:10px;line-height:1;">♿</div>` : "";

  return L.divIcon({
    className: "orienta-pax-marker",
    html: `<div style="position:relative;width:16px;height:16px;">
      <div style="width:16px;height:16px;border-radius:50%;background:${color};
        border:2px solid rgba(255,255,255,1);
        box-shadow:0 0 10px ${color}99,0 2px 8px rgba(0,0,0,0.5);"></div>
      ${badge}${premBadge}${wcBadge}
    </div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

export default class LeafletAdapter {
  private map!: L.Map;
  private gateMarkers = new Map<string, L.Marker>();
  private paxMarkers  = new Map<string, L.Marker>();
  private tracks: L.Polyline[] = [];
  private staticRoutePolylines: L.Polyline[] = [];
  private opts!: CreateOptions;
  private lastData: Parameters<LeafletAdapter["setData"]>[0] | null = null;

  static async create(container: HTMLElement, opts: CreateOptions): Promise<LeafletAdapter> {
    const inst = new LeafletAdapter();
    inst.opts = opts;

    // Clear stale Leaflet state (React remount safety)
    if ((container as any)._leaflet_id) {
      delete (container as any)._leaflet_id;
    }

    // Initialize map — even if container is display:none right now,
    // we set a valid center; invalidateSize() is called when tab becomes visible.
    const c0 = opts.initialCenter ? [opts.initialCenter.lat, opts.initialCenter.lng] as [number, number] : DEFAULT_CENTER;
    const z0 = opts.initialCenter ? 15 : 16;

    inst.map = L.map(container, {
      zoomControl: true,
      preferCanvas: true,
      attributionControl: false,
    }).setView(c0, z0);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(inst.map);

    container.style.cursor = "grab";
    inst.map.on("dragstart", () => { container.style.cursor = "grabbing"; });
    inst.map.on("dragend",   () => { container.style.cursor = "grab"; });

    return inst;
  }

  /** Call this whenever the map container becomes visible (tab switch) */
  invalidate() {
    setTimeout(() => {
      this.map.invalidateSize();
      if (this.lastData) {
        this._fitAll(this.lastData.gates, this.lastData.passengers);
      }
    }, 50);
  }

  destroy() {
    try { this.map.remove(); } catch {}
  }

  private _fitAll(gates: Gate[], passengers: PassengerComputed[]) {
    const pts: [number, number][] = [
      ...gates.map(g => [g.coordinate.lat, g.coordinate.lng] as [number, number]),
      ...passengers.map(p => [p.location.lat, p.location.lng] as [number, number]),
    ];
    if (pts.length === 0) return;
    try {
      this.map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 17 });
    } catch {}
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
    const isFirstLoad = this.lastData === null;
    this.lastData = data;
    const { gates, passengers, tracks, staticRoutes = [] } = data;

    // ── Gates ──
    const keepG = new Set(gates.map(g => g.id));
    for (const [id, m] of this.gateMarkers) {
      if (!keepG.has(id)) { m.remove(); this.gateMarkers.delete(id); }
    }
    for (const g of gates) {
      if (this.gateMarkers.has(g.id)) continue;
      const m = L.marker([g.coordinate.lat, g.coordinate.lng], { icon: gateIcon(g.name) })
        .addTo(this.map)
        .on("click", () => this.opts.onSelectGate(g.id));
      m.bindTooltip(`Gate ${g.name}`, { direction: "top", offset: [0, -8], opacity: 0.92 });
      this.gateMarkers.set(g.id, m);
    }

    // ── Passengers ──
    const keepP = new Set(passengers.map(p => p.id));
    for (const [id, m] of this.paxMarkers) {
      if (!keepP.has(id)) { m.remove(); this.paxMarkers.delete(id); }
    }
    for (const p of passengers) {
      const icon = paxIcon(p);
      const online = (p as any).rtOnline ? "online" : "offline";
      const risk = extStatus(p);
      const label = `${p.name} (${p.id}) · ${online}` +
        (risk && risk !== online ? ` · ${risk}` : "") +
        (p.transfer ? ` · ${p.transfer.inboundFrom}→${p.transfer.outboundTo}` : "");
      const existing = this.paxMarkers.get(p.id);
      if (existing) {
        existing.setLatLng([p.location.lat, p.location.lng]);
        existing.setIcon(icon);
        try {
          const tt: any = (existing as any).getTooltip?.();
          if (tt && tt.setContent) tt.setContent(label);
        } catch {}
        continue;
      }
      const m = L.marker([p.location.lat, p.location.lng], { icon })
        .addTo(this.map)
        .on("click",     () => this.opts.onSelectPassenger(p.id))
        .on("mouseover", () => this.opts.onHoverPassenger?.(p.id))
        .on("mouseout",  () => this.opts.onHoverPassenger?.(null));
      m.bindTooltip(label, { direction: "top", offset: [0, -8], opacity: 0.92 });
      this.paxMarkers.set(p.id, m);
    }

    // ── Tracks ──
    this.tracks.forEach(t => t.remove());
    this.tracks = [];
    for (const t of tracks) {
      const pl = L.polyline(
        t.points.map(pt => [pt.lat, pt.lng] as [number, number]),
        { weight: 4, opacity: 0.9, color: t.color, dashArray: "6 8" }
      ).addTo(this.map);
      this.tracks.push(pl);
    }

    // ── Static routes (e.g. E15→E19) ──
    this.staticRoutePolylines.forEach(p => p.remove());
    this.staticRoutePolylines = [];
    for (const r of staticRoutes) {
      if (r.points.length < 2) continue;
      const pl = L.polyline(
        r.points.map(pt => [pt.lat, pt.lng] as [number, number]),
        { weight: 5, opacity: 0.85, color: r.color ?? "#0a84ff" }
      ).addTo(this.map);
      this.staticRoutePolylines.push(pl);
    }

    // On first data load: fit bounds (works if container is visible)
    // If container is still display:none, invalidate() will redo this when tab opens
    if (isFirstLoad) {
      this._fitAll(gates, passengers);
    }
  }
}
