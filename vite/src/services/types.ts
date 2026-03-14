export type LatLng = { lat: number; lng: number };

export type Gate = {
  id: string;
  name: string;
  coordinate: LatLng;
  tags?: Record<string, string>;
};

export type Flight = {
  id: string;
  callsign: string;
  destination: string;
  scheduledDep: string;
  status: "Gate Open" | "Boarding" | "Final Call" | "Closed" | "Delayed";
  gateRef?: string;
  gateId?: string;
};

export type PassengerActivity =
  | "moving"
  | "shopping"
  | "dining"
  | "idle"
  | "at_gate"
  | "boarded";

export type TransferDirection = "intl_to_intl" | "intl_to_dom" | "dom_to_intl" | "dom_to_dom";

export type TransferInfo = {
  direction: "intl_to_intl";
  urgency: "urgent" | "normal";
  inboundFlight: string;
  inboundFrom: string;
  inboundArr: string;
  outboundFlight: string;
  outboundTo: string;
  outboundDep: string;
  note?: string;
};

export type PaxExtStatus =
  | "green"
  | "yellow"
  | "red"
  | "missed"
  | "offline"
  | "lost"
  | "gray";

export type PaxPlan = "premium" | "free";

export type Passenger = {
  id: string;
  name: string;
  nationality: string;
  locale: string;
  needsWheelchair: boolean;
  plan: PaxPlan;
  transfer: TransferInfo;
  flightId: string;
  gateId: string;
  activity: PassengerActivity;
  location: LatLng;
  path?: LatLng[];
  pathIndex?: number;
  lastUpdateMs?: number;
  extStatus: PaxExtStatus;
  locationLostAt?: number;
};

export type PassengerStatus = "green" | "yellow" | "red" | "gray";

export type PassengerComputed = Passenger & {
  etaMinutes: number | null;
  status: PassengerStatus;
  reason: string;
};

export type GateStats = {
  total: number;
  boarded: number;
  enRoute: number;
  notMoving: number;
  atGateWaiting: number;
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
