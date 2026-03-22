import type { LatLng } from "../services/types";

/**
 * Waypoints for PEK trajectory E15 → E19 (from route_folder/E15_to_E19.txt).
 * The route_site video map builds its polyline from `public/route_site/PEK_landmarks.csv` (by gate range), not this array.
 */
export const ROUTE_E15_TO_E19: LatLng[] = [
  { lat: 40.079188, lng: 116.610013 },
  { lat: 40.07885, lng: 116.609573 },
  { lat: 40.078642, lng: 116.608943 },
  { lat: 40.07826, lng: 116.608302 },
  { lat: 40.077897, lng: 116.607674 },
];
