import { haversineMeters } from "@/lib/distance";
import type { Coordinates } from "@/lib/types";

/** Metro then tram, the order chips always appear in. */
export const RAIL_LINES = ["M1", "M2", "M3", "T6", "T7"] as const;
export type RailLine = (typeof RAIL_LINES)[number];

export interface RailStation extends Coordinates {
  name: string;
  lines: RailLine[];
}

export interface StationDistance {
  station: RailStation;
  meters: number;
}

/**
 * The stops at a station, about 3 minutes on foot. Station points are the
 * centre of the platforms, and big interchanges have their entrances and own
 * named stops up to ~180 m from it (Syntagma), so 150 m missed real ones.
 */
export const CHIP_RADIUS_METERS = 200;
/** A new closest station must beat the current one by this much to take over. */
const SWITCH_MARGIN_METERS = 50;
/** About two bus stops, or 2–3 minutes at Athens bus speeds. */
export const HEADS_UP_METERS = 600;
/** How much closer you must get before an approach counts as one. */
const APPROACH_METERS = 50;
/** How far you must go before the same station can be announced again. */
const REARM_METERS = 1_000;

export function isMetroLine(line: RailLine): boolean {
  return line.startsWith("M");
}

/** Every line with a station within `radius` of the point, in chip order. */
export function linesNear(
  point: Coordinates,
  stations: readonly RailStation[],
  radius = CHIP_RADIUS_METERS,
): RailLine[] {
  const lines = new Set<RailLine>();
  for (const station of stations) {
    if (haversineMeters(point, station) <= radius) {
      for (const line of station.lines) lines.add(line);
    }
  }
  return RAIL_LINES.filter((line) => lines.has(line));
}

/** The station a stop is "by": the nearest metro in range, else the nearest tram. */
export function stationAt(
  point: Coordinates,
  stations: readonly RailStation[],
  radius = CHIP_RADIUS_METERS,
): RailStation | null {
  const inRange = stations
    .map((station) => ({ station, meters: haversineMeters(point, station) }))
    .filter(({ meters }) => meters <= radius)
    .sort((a, b) => a.meters - b.meters);
  return (
    inRange.find(({ station }) => station.lines.some(isMetroLine)) ??
    inRange[0]
  )?.station ?? null;
}

/** Words for screen readers, such as "metro lines 2 and 3 and tram line 6". */
export function describeLines(lines: readonly RailLine[]): string {
  const mode = (name: string, numbers: string[]) =>
    numbers.length === 0
      ? []
      : [
          `${name} ${numbers.length === 1 ? "line" : "lines"} ${numbers.join(" and ")}`,
        ];
  return [
    ...mode("metro", lines.filter(isMetroLine).map((line) => line.slice(1))),
    ...mode("tram", lines.filter((line) => !isMetroLine(line)).map((line) => line.slice(1))),
  ].join(" and ");
}

/** The nearest station served by the metro, ignoring tram-only stops. */
export function closestMetro(
  point: Coordinates,
  stations: readonly RailStation[],
): StationDistance | null {
  let closest: StationDistance | null = null;
  for (const station of stations) {
    if (!station.lines.some(isMetroLine)) continue;
    const meters = haversineMeters(point, station);
    if (!closest || meters < closest.meters) closest = { station, meters };
  }
  return closest;
}

/**
 * The closest metro station, keeping the previous one until another is clearly
 * nearer, so riding between two stations reads as one steady target.
 */
export function stickyClosest(
  previous: RailStation | null,
  point: Coordinates,
  stations: readonly RailStation[],
): StationDistance | null {
  const closest = closestMetro(point, stations);
  if (!closest || !previous || previous === closest.station) return closest;

  const previousMeters = haversineMeters(point, previous);
  return previousMeters - closest.meters < SWITCH_MARGIN_METERS
    ? { station: previous, meters: previousMeters }
    : closest;
}

export interface ApproachState {
  /** The station being approached and the furthest you've been from it since. */
  target: { station: RailStation; furthestMeters: number } | null;
  /** Stations already announced, until you've gone far enough to re-arm them. */
  announced: RailStation[];
}

export const INITIAL_APPROACH: ApproachState = { target: null, announced: [] };

/**
 * Decides whether a reading is the moment to say a metro station is ahead:
 * within 600 m and getting closer, once per station until you've left it 1 km
 * behind. Standing near a station never counts as approaching it.
 */
export function approach(
  state: ApproachState,
  point: Coordinates,
  closest: StationDistance | null,
): { state: ApproachState; headsUp: StationDistance | null } {
  const announced = state.announced.filter(
    (station) => haversineMeters(point, station) <= REARM_METERS,
  );

  if (
    !closest ||
    closest.meters > HEADS_UP_METERS ||
    announced.includes(closest.station)
  ) {
    return { state: { target: null, announced }, headsUp: null };
  }

  const furthestMeters =
    state.target?.station === closest.station
      ? Math.max(state.target.furthestMeters, closest.meters)
      : closest.meters;

  if (furthestMeters - closest.meters >= APPROACH_METERS) {
    return {
      state: { target: null, announced: [...announced, closest.station] },
      headsUp: closest,
    };
  }

  return {
    state: { target: { station: closest.station, furthestMeters }, announced },
    headsUp: null,
  };
}
