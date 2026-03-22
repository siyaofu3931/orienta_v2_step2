import React from "react";

export type MapMode = "auto" | "apple" | "osm";

export default function TopBar(props: {
  search: string;
  onSearch(v: string): void;
  title?: string;
  subtitle?: string;
  searchPlaceholder?: string;
  mapMode: MapMode;
  setMapMode(m: MapMode): void;
  paused: boolean;
  setPaused(v: boolean): void;
  gateCount: number;
  passengerCount: number;
  transferCount?: number;
  transferUrgentCount?: number;
  dataSource: string;
  userLabel?: string;
  onLogout?: () => void;
  extraRight?: React.ReactNode;
  onPaxClick?: () => void;
  onUrgentClick?: () => void;
  mapViewFilter?: "all" | "single" | "urgent";
}) {
  const {
    search,
    onSearch,
    title = "中国国际航空公司后台",
    subtitle = "国航 · Gate / Passenger Ops",
    searchPlaceholder = "搜索登机口（如 E21 / D06）…",
    mapMode,
    setMapMode,
    paused,
    setPaused,
    gateCount,
    passengerCount,
    transferCount,
    transferUrgentCount,
    dataSource,
    userLabel,
    onLogout,
    extraRight,
    onPaxClick,
    onUrgentClick,
    mapViewFilter = "all",
  } = props;

  const Chip = ({ label, value }: { label: string; value: MapMode }) => (
    <span className={"chip " + (mapMode === value ? "active" : "")}>
      <button onClick={() => setMapMode(value)}>{label}</button>
    </span>
  );

  return (
    <div className="topbar">
      <div className="brand">
        <img className="logo" src="/airchina-logo.png" alt="中国国际航空" />
        <div>
          <div className="title">{title}</div>
          <div className="subtitle">{subtitle}</div>
        </div>
      </div>

      <div className="search">
        <input
          className="input"
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
        <span className={"chip " + (paused ? "active" : "")}>
          <button onClick={() => setPaused(!paused)}>{paused ? "暂停" : "运行"}</button>
        </span>
        <Chip label="Auto" value="auto" />
        <Chip label="Apple" value="apple" />
        <Chip label="OSM" value="osm" />
        <span className="chip">Gate: {gateCount}</span>
        <span className={"chip " + (mapViewFilter === "all" ? "active" : "")}>
          <button onClick={onPaxClick} title="Show all passengers">{passengerCount > 0 ? `Pax: ${passengerCount}` : "Pax: 0"}</button>
        </span>
        {typeof transferCount === "number" ? <span className="chip">Transfer: {transferCount}</span> : null}
        {typeof transferUrgentCount === "number" ? (
          <span className={"chip " + (mapViewFilter === "urgent" ? "active" : "")}>
            <button onClick={onUrgentClick} title="Show urgent passengers only">Urgent: {transferUrgentCount}</button>
          </span>
        ) : null}
        <span className="chip">Data: {dataSource}</span>
      </div>

      <div className="topbarRight">
        {userLabel ? <span className="chip">{userLabel}</span> : null}
        {extraRight}
        {onLogout ? (
          <button className="btn" onClick={onLogout} title="退出登录">
            退出
          </button>
        ) : null}
      </div>
    </div>
  );
}
