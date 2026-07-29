import type { Coordinates } from "@/lib/types";

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

/** Calculates straight-line distance between two WGS84 coordinates. */
export function haversineMeters(
  from: Coordinates,
  to: Coordinates,
): number {
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);

  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return Math.round(
    EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)),
  );
}

export function formatDistance(distanceMeters: number): string {
  if (distanceMeters < 1_000) {
    return `${distanceMeters} m`;
  }

  return `${(distanceMeters / 1_000).toFixed(1)} km`;
}
