import { z } from "zod";
import type { Arrival } from "@/lib/types";

export const ARRIVAL_CACHE_KEY = "athens-bus-ticker:arrivals:v2";
const LEGACY_ARRIVAL_CACHE_KEY = "athens-bus-ticker:arrivals:v1";
const MAX_CACHED_STOPS = 5;

export interface ArrivalsPayload {
  arrivals: Arrival[];
  observedAt: string;
}

export interface CachedArrivalSchedule {
  stopCode: string;
  data: ArrivalsPayload;
  nextPollAt: string;
}

const scheduleSchema = z.object({
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
});

const cacheSchema = z.object({
  version: z.literal(2),
  entries: z.array(scheduleSchema).max(MAX_CACHED_STOPS),
});

const legacyCacheSchema = scheduleSchema.extend({
  version: z.literal(1),
  pollIntervalMs: z.number().positive(),
});

function readCache(): CachedArrivalSchedule[] {
  try {
    const raw =
      window.localStorage.getItem(ARRIVAL_CACHE_KEY) ??
      window.localStorage.getItem(LEGACY_ARRIVAL_CACHE_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    const current = cacheSchema.safeParse(value);
    if (current.success) return current.data.entries;
    const legacy = legacyCacheSchema.safeParse(value);
    return legacy.success ? [legacy.data] : [];
  } catch {
    return [];
  }
}

export function readCachedArrivals(
  stopCode: string,
): CachedArrivalSchedule | null {
  if (typeof window === "undefined") return null;

  return readCache().find((entry) => entry.stopCode === stopCode) ?? null;
}

export function writeCachedArrivals(
  stopCode: string,
  data: ArrivalsPayload,
  nextPollAt: number,
): void {
  const entry: CachedArrivalSchedule = {
    stopCode,
    data,
    nextPollAt: new Date(nextPollAt).toISOString(),
  };
  const entries = [
    entry,
    ...readCache().filter((cached) => cached.stopCode !== stopCode),
  ].slice(0, MAX_CACHED_STOPS);

  try {
    window.localStorage.setItem(
      ARRIVAL_CACHE_KEY,
      JSON.stringify({ version: 2, entries }),
    );
  } catch {
    // Polling remains functional when storage is unavailable or full.
  }
}

export function clearCachedArrivals(): void {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(ARRIVAL_CACHE_KEY);
    window.localStorage.removeItem(LEGACY_ARRIVAL_CACHE_KEY);
  }
}
