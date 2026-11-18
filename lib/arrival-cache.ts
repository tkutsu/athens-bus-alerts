import { z } from "zod";
import type { Arrival } from "@/lib/types";

export const ARRIVAL_CACHE_KEY = "athens-bus-ticker:arrivals:v2";
const MAX_CACHED_STOPS = 5;
// Older arrivals say nothing about where buses are now.
const MAX_SNAPSHOT_AGE_MS = 60 * 60_000;

export interface ArrivalsPayload {
  arrivals: Arrival[];
  observedAt: string;
}

export interface CachedArrivalSchedule {
  stopCode: string;
  data: ArrivalsPayload;
  nextPollAt: string;
  unavailable?: boolean;
}

export const arrivalsPayloadSchema = z.object({
  arrivals: z.array(
    z.object({
      routeCode: z.string(),
      vehicleId: z.string(),
      minutes: z.number().int().nonnegative(),
    }),
  ),
  observedAt: z.iso.datetime(),
});

const scheduleSchema = z.object({
  stopCode: z.string(),
  data: arrivalsPayloadSchema,
  nextPollAt: z.iso.datetime(),
  unavailable: z.boolean().optional(),
});

const cacheSchema = z.object({
  version: z.literal(2),
  entries: z.array(scheduleSchema).max(MAX_CACHED_STOPS),
});

function readCache(): CachedArrivalSchedule[] {
  try {
    const raw = window.localStorage.getItem(ARRIVAL_CACHE_KEY);
    if (!raw) return [];
    const cache = cacheSchema.safeParse(JSON.parse(raw));
    if (!cache.success) return [];
    const oldest = Date.now() - MAX_SNAPSHOT_AGE_MS;
    return cache.data.entries.filter((entry) => Date.parse(entry.data.observedAt) >= oldest);
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
  unavailable = false,
): void {
  const entry: CachedArrivalSchedule = {
    stopCode,
    data,
    nextPollAt: new Date(nextPollAt).toISOString(),
    unavailable,
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
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ARRIVAL_CACHE_KEY);
  } catch {
    // Clearing active tracking must still work when storage is unavailable.
  }
}
