import type { Flight, Gate } from "./types";
import { buildIntlFlights } from "./passengerSim";

export function loadFlights(_airport: string): { flights: Flight[]; provider: string } {
  return { flights: buildIntlFlights(), provider: "mock_intl" };
}

export function resolveFlightsToGates(flights: Flight[], _gates: Gate[]): Flight[] {
  return flights;
}

export function pickFlightForGate(gateName: string, flights: Flight[]): Flight | null {
  return flights.find(f => f.gateRef === gateName || f.gateId === gateName) || null;
}
