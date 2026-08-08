import type { Arrival, RouteStop, StopSummary, UserLocation } from "@/lib/types";
import {
  MAX_ALTERNATE_RADIUS_METERS,
  catchMarginSeconds,
  estimateWalk,
} from "@/lib/walking";

export interface CatchOption {
  stop: Pick<StopSummary, "code" | "name" | "latitude" | "longitude">;
  arrival: Arrival;
  walkSeconds: number;
  leaveInSeconds: number;
  catchable: boolean;
}

export interface BetterStopOption extends CatchOption {
  sameVehicle: boolean;
  baseline: CatchOption;
}

/** Keeps only the closest route stops worth polling for alternatives. */
export function alternateStopCandidates(
  stops: readonly RouteStop[],
  currentStopCode: string,
  location: UserLocation,
  limit = 3,
): RouteStop[] {
  return stops
    .filter((stop) => stop.code !== currentStopCode)
    .map((stop) => ({ stop, walk: estimateWalk(location, stop) }))
    .filter(({ walk }) => walk.straightLineMeters <= MAX_ALTERNATE_RADIUS_METERS)
    .sort(
      (a, b) =>
        a.walk.seconds - b.walk.seconds ||
        a.stop.code.localeCompare(b.stop.code, "en", { numeric: true }),
    )
    .slice(0, limit)
    .map(({ stop }) => stop);
}

export function catchOptionsForStop(
  stop: CatchOption["stop"],
  arrivals: readonly Arrival[],
  location: UserLocation,
): CatchOption[] {
  const walk = estimateWalk(location, stop);
  return arrivals
    .map((arrival) => {
      const margin = catchMarginSeconds(arrival.minutes, walk.seconds);
      return {
        stop,
        arrival,
        walkSeconds: walk.seconds,
        leaveInSeconds: Math.max(0, margin),
        catchable: margin >= 0,
      };
    })
    .sort(
      (a, b) =>
        a.arrival.minutes - b.arrival.minutes ||
        a.arrival.vehicleId.localeCompare(b.arrival.vehicleId),
    );
}

/** Chooses the first catchable bus, falling back to the next visible bus. */
export function representativeCatchOption(
  options: readonly CatchOption[],
): CatchOption | null {
  return options.find((option) => option.catchable) ?? options[0] ?? null;
}

/** Returns one materially superior alternate stop/bus combination. */
export function bestAlternateStop(
  baseline: CatchOption | null,
  alternatives: readonly CatchOption[],
): BetterStopOption | null {
  if (!baseline) return null;
  const eligible = alternatives.flatMap((alternative) => {
    if (!alternative.catchable) return [];
    const sameVehicle =
      alternative.arrival.routeCode === baseline.arrival.routeCode &&
      alternative.arrival.vehicleId === baseline.arrival.vehicleId;
    const walkSavings = baseline.walkSeconds - alternative.walkSeconds;
    const boardsEarlierSeconds =
      (baseline.arrival.minutes - alternative.arrival.minutes) * 60;
    const leavesLaterSeconds =
      alternative.leaveInSeconds - baseline.leaveInSeconds;
    const improved =
      !baseline.catchable ||
      boardsEarlierSeconds >= 180 ||
      (sameVehicle && walkSavings >= 120 && leavesLaterSeconds >= 120) ||
      (boardsEarlierSeconds >= 0 && walkSavings >= 120);
    return improved ? [{ ...alternative, sameVehicle, baseline }] : [];
  });

  return (
    eligible.sort(
      (a, b) =>
        a.arrival.minutes - b.arrival.minutes ||
        b.leaveInSeconds - a.leaveInSeconds ||
        a.walkSeconds - b.walkSeconds ||
        a.stop.code.localeCompare(b.stop.code, "en", { numeric: true }),
    )[0] ?? null
  );
}
