import { haversineMeters } from "@/lib/distance";
import type { Coordinates, UserLocation } from "@/lib/types";

export const WALK_DETOUR_FACTOR = 1.3;
export const WALK_SPEED_METERS_PER_SECOND = 1.25;
export const MAX_LOCATION_AGE_MS = 120_000;
export const MAX_LOCATION_ACCURACY_METERS = 75;

/** Rejects old or imprecise positions before calculating walking alerts. */
export function isUsableLocation(
  location: UserLocation | null,
  nowMs = Date.now(),
): location is UserLocation {
  return Boolean(
    location &&
      Number.isFinite(location.latitude) &&
      Number.isFinite(location.longitude) &&
      location.accuracyMeters <= MAX_LOCATION_ACCURACY_METERS &&
      nowMs - new Date(location.observedAt).getTime() <= MAX_LOCATION_AGE_MS,
  );
}

/** Produces a conservative local walk estimate without sending coordinates away. */
export function estimateWalkSeconds(
  origin: Coordinates,
  destination: Coordinates,
): number {
  const straightLineMeters = haversineMeters(origin, destination);
  const estimatedPathMeters = straightLineMeters * WALK_DETOUR_FACTOR;
  return Math.max(
    30,
    Math.ceil(estimatedPathMeters / WALK_SPEED_METERS_PER_SECOND),
  );
}
