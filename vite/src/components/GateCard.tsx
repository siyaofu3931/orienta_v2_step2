import React from "react";
import type { Gate, Flight, PassengerComputed, GateStats } from "../services/types";
import { fmtTime } from "../services/utils";

function StatusBadge({ status }: { status: Flight["status"] }) {
  const map: Record<Flight["status"], { dot: string; label: string }> = {
    "Gate Open": { dot: "green", label: "Gate Open" },
    "Boarding": { dot: "green", label: "Boarding" },
    "Final Call": { dot: "yellow", label: "Final Call" },
    "Closed": { dot: "red", label: "Closed" },
    "Delayed": { dot: "yellow", label: "Delayed" }
  };
  const v = map[status];
  return (
    <span className="badge">
      <span className={"dot " + v.dot} />
      {v.label}
    </span>
  );
}

export default function GateCard(props: {
  gate: Gate;
  flight: Flight | null;
  stats: GateStats | null;
  passengers: PassengerComputed[];
  onSelectPassenger(id: string): void;
}) {
  const { gate, flight, stats, passengers } = props;
  const dep = flight ? fmtTime(flight.scheduledDep) : "--:--";

  return (
    <div className="card">
      <h3>登机口 {gate.name}</h3>
      <div className="row">
        <div className="kv">
          <div className="k">航班</div>
          <div className="v">{flight?.callsign || "—"}</div>
        </div>
        <div className="kv">
          <div className="k">目的地</div>
          <div className="v">{flight?.destination || "—"}</div>
        </div>
      </div>

      <div className="row">
        <div className="kv">
          <div className="k">计划起飞</div>
          <div className="v">{dep}</div>
        </div>
        <div className="kv">
          <div className="k">状态</div>
          <div className="v">{flight ? <StatusBadge status={flight.status} /> : "—"}</div>
        </div>
      </div>

      <div className="hr" />

      <div className="row">
        <div className="kv">
          <div className="k">旅客总数</div>
          <div className="v">{stats?.total ?? passengers.filter(p => p.gateId === gate.id).length}</div>
        </div>
        <div className="kv">
          <div className="k">已登机</div>
          <div className="v">{stats?.boarded ?? 0}</div>
        </div>
      </div>

      <div className="row">
        <div className="kv">
          <div className="k">在路上（有轨迹）</div>
          <div className="v">{stats?.enRoute ?? 0}</div>
        </div>
        <div className="kv">
          <div className="k">停留（购物/餐饮）</div>
          <div className="v">{stats?.notMoving ?? 0}</div>
        </div>
      </div>

      <div className="hr" />

      <div className="small" style={{ marginBottom: 8 }}>该登机口关联旅客（点击查看）：</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {passengers
          .filter(p => p.gateId === gate.id)
          .slice(0, 12)
          .map(p => (
            <button
              key={p.id}
              className="btn"
              onClick={() => props.onSelectPassenger(p.id)}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className={"dot " + (p.status === "gray" ? "gray" : p.status)} />
                {p.name} <span className="small">({p.id})</span>
                <span className="small">{p.nationality}</span>
                {p.needsWheelchair ? <span className="small">♿</span> : null}
                {p.plan === "premium" ? <span className="small">💎 Premium</span> : null}
              </span>
              <span className="small">{p.activity === "moving" ? "在路上" : p.activity === "shopping" ? "购物" : p.activity === "dining" ? "餐饮" : p.activity === "lounge" ? "休息室" : p.activity === "idle" ? "停留" : p.activity === "at_gate" ? "已到口" : "已登机"}</span>
            </button>
          ))}
        {passengers.filter(p => p.gateId === gate.id).length > 12 ? (
          <div className="small">（仅展示前 12 人，地图上可查看全部）</div>
        ) : null}
      </div>
    </div>
  );
}
