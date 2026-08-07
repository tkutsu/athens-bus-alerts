import { z } from "zod";
import type { Arrival } from "@/lib/types";

export const ARRIVAL_CACHE_KEY = "athens-bus-ticker:arrivals:v1";

export interface ArrivalsPayload {
  arrivals: Arrival[];
  observedAt: string;
}

export interface CachedArrivalSchedule {
  version: 1;
  stopCode: string;
  data: ArrivalsPayload;
  nextPollAt: string;
  pollIntervalMs: number;
}

const cacheSchema = z.object({
  version: z.literal(1),
  stopCode: z.string(),
  data: z.object({
    arrivals: z.array(
      z.object({
        routeCode: z.string(),
        vehicleId: z.string(),
        minutes: z.number().int().nonnegative(),
      }),
    ),
    observedAt: z.iso.datetime(),
  }),
  nextPollAt: z.iso.datetime(),
  pollIntervalMs: z.number().positive(),
});

export function readCachedArrivals(
  stopCode: string,
): CachedArrivalSchedule | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(ARRIVAL_CACHE_KEY);
    if (!raw) return null;
    const parsed = cacheSchema.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.stopCode === stopCode
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}

export function writeCachedArrivals(
  stopCode: string,
  data: ArrivalsPayload,
  nextPollAt: number,
  pollIntervalMs: number,
): void {
  const cache: CachedArrivalSchedule = {
    version: 1,
    stopCode,
    data,
    nextPollAt: new Date(nextPollAt).toISOString(),
    pollIntervalMs,
  };
  window.localStorage.setItem(ARRIVAL_CACHE_KEY, JSON.stringify(cache));
}

export function clearCachedArrivals(): void {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(ARRIVAL_CACHE_KEY);
  }
}
