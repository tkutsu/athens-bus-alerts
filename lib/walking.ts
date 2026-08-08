import { haversineMeters } from "@/lib/distance";
import type { Coordinates, UserLocation } from "@/lib/types";

export const WALK_DETOUR_FACTOR = 1.3;
export const WALK_SPEED_METERS_PER_SECOND = 1.25;
export const CATCH_SAFETY_SECONDS = 90;
export const MAX_ALTERNATE_RADIUS_METERS = 600;
export const MAX_LOCATION_AGE_MS = 120_000;
export const MAX_LOCATION_ACCURACY_METERS = 75;

export interface WalkEstimate {
  straightLineMeters: number;
  estimatedPathMeters: number;
  seconds: number;
  minutes: number;
}

/** Rejects old or imprecise positions before presenting catch advice. */
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
export function estimateWalk(
  origin: Coordinates,
  destination: Coordinates,
): WalkEstimate {
  const straightLineMeters = haversineMeters(origin, destination);
  const estimatedPathMeters = straightLineMeters * WALK_DETOUR_FACTOR;
  const seconds = Math.max(
    30,
    Math.ceil(estimatedPathMeters / WALK_SPEED_METERS_PER_SECOND),
  );
  return {
    straightLineMeters,
    estimatedPathMeters,
    seconds,
    minutes: Math.ceil(seconds / 60),
  };
}

export function catchMarginSeconds(
  arrivalMinutes: number,
  walkSeconds: number,
): number {
  return arrivalMinutes * 60 - walkSeconds - CATCH_SAFETY_SECONDS;
}
