import { haversineMeters } from "@/lib/distance";
import type { Coordinates, UserLocation } from "@/lib/types";

const WALK_DETOUR_FACTOR = 1.3;
const WALK_SPEED_METERS_PER_SECOND = 1.25;
const MAX_LOCATION_ACCURACY_METERS = 75;

/**
 * Rejects imprecise positions before calculating walking alerts. Age is not
 * checked: a live watch only reports movement, so a quiet one means you stayed put.
 */
export function isUsableLocation(
  location: UserLocation | null,
): location is UserLocation {
  return Boolean(
    location &&
      Number.isFinite(location.latitude) &&
      Number.isFinite(location.longitude) &&
      location.accuracyMeters <= MAX_LOCATION_ACCURACY_METERS,
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

/** Slack for GPS noise and whole-minute ETAs before a bus counts as missed. */
const REACH_GRACE_SECONDS = 30;
/** About a minute's walk or less counts as being at the stop. */
const AT_STOP_WALK_SECONDS = 60;

/** The ETA, in minutes, a bus needs for you to walk to the stop in time; 0 at the stop. */
export function reachMinutes(walkSeconds: number | undefined): number {
  if (walkSeconds === undefined || walkSeconds <= AT_STOP_WALK_SECONDS) return 0;
  return (walkSeconds - REACH_GRACE_SECONDS) / 60;
}

/** Whether you can still make a bus, assuming you can when your location is unknown. */
export function canReachBus(
  minutes: number,
  walkSeconds: number | undefined,
): boolean {
  return minutes >= reachMinutes(walkSeconds);
}
