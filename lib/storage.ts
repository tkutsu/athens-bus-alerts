import { z } from "zod";
import type { LineSubscription, StoredState } from "@/lib/types";
import { clearCachedArrivals } from "@/lib/arrival-cache";

export const STORAGE_KEY = "athens-bus-ticker:v5";

const stopReferenceSchema = z.object({
  code: z.string(),
  name: z.string(),
});

const recentVehicleSchema = z.object({
  key: z.string(),
  completedAt: z.string(),
});

const subscriptionSchema = z.object({
  lineId: z.string(),
  routeCode: z.string().nullable(),
  trackedVehicleKey: z.string().nullable(),
  firedLeaveNow: z.boolean(),
  firedOneMinute: z.boolean(),
  predictedLeaveAt: z.string().nullable(),
  predictedZeroAt: z.string().nullable(),
  lastObservedMinutes: z.number().nullable(),
  recentVehicles: z.array(recentVehicleSchema),
});

const favoriteSchema = z.object({
  id: z.string(),
  name: z.string(),
  stop: stopReferenceSchema,
  routes: z.array(
    z.object({ lineId: z.string(), routeCode: z.string().nullable() }),
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastEnabledAt: z.string().nullable(),
});

const storedStateSchema = z.object({
  version: z.literal(5),
  selectedStop: stopReferenceSchema.nullable(),
  subscriptions: z.array(subscriptionSchema),
  favorites: z.array(favoriteSchema),
});

export const DEFAULT_STORED_STATE: StoredState = {
  version: 5,
  selectedStop: null,
  subscriptions: [],
  favorites: [],
};

/** Creates a fresh subscription without guessing a physical vehicle. */
export function createSubscription(
  lineId: string,
  routeCode: string | null = null,
): LineSubscription {
  return {
    lineId,
    routeCode,
    trackedVehicleKey: null,
    firedLeaveNow: false,
    firedOneMinute: false,
    predictedLeaveAt: null,
    predictedZeroAt: null,
    lastObservedMinutes: null,
    recentVehicles: [],
  };
}

export function readStoredState(): StoredState {
  if (typeof window === "undefined") return DEFAULT_STORED_STATE;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STORED_STATE;
    const stored = storedStateSchema.safeParse(JSON.parse(raw));
    return stored.success ? stored.data : DEFAULT_STORED_STATE;
  } catch {
    return DEFAULT_STORED_STATE;
  }
}

export function writeStoredState(state: StoredState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Tracking remains usable in memory when storage is unavailable or full.
  }
}

export function clearStoredState(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // A failed removal must not prevent clearing the active in-memory state.
  }
  clearCachedArrivals();
}
