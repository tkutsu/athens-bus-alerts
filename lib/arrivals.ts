import type { Arrival } from "@/lib/types";

/** Keeps one earliest prediction for each physical vehicle on a route. */
export function dedupeArrivals(arrivals: Arrival[]): Arrival[] {
  const unique = new Map<string, Arrival>();

  for (const arrival of arrivals) {
    const key = `${arrival.routeCode}\u0000${arrival.vehicleId}`;
    const existing = unique.get(key);
    if (!existing || arrival.minutes < existing.minutes) {
      unique.set(key, arrival);
    }
  }

  return [...unique.values()].sort((a, b) => a.minutes - b.minutes);
}
