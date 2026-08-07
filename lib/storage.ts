import { z } from "zod";
import type {
  Favorite,
  LineSubscription,
  StoredState,
} from "@/lib/types";
import { clearCachedArrivals } from "@/lib/arrival-cache";

export const STORAGE_KEY = "athens-bus-ticker:v4";
export const V3_STORAGE_KEY = "athens-bus-ticker:v3";
export const LEGACY_STORAGE_KEY = "athens-bus-ticker:v2";

const optionalThresholdSchema = z.union([
  z.literal(10),
  z.literal(5),
  z.literal(3),
  z.literal(1),
]);

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
  trackedVehicleKey: z.string().nullable(),
  firedOneMinute: z.boolean(),
  predictedZeroAt: z.string().nullable(),
  lastObservedMinutes: z.number().nullable(),
  recentVehicles: z.array(recentVehicleSchema),
});

const favoriteSchemaV4 = z.object({
  id: z.string(),
  name: z.string(),
  stop: stopReferenceSchema,
  lineIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastEnabledAt: z.string().nullable(),
});

const storedStateSchemaV4 = z.object({
  version: z.literal(4),
  selectedStop: stopReferenceSchema.nullable(),
  subscriptions: z.array(subscriptionSchema),
  favorites: z.array(favoriteSchemaV4),
});

const lineAlertSchemaV3 = z.object({
  lineId: z.string(),
  optionalThresholds: z.array(optionalThresholdSchema),
});

const activeLineAlertSchemaV3 = lineAlertSchemaV3.extend({
  firedThresholds: z.array(
    z.union([optionalThresholdSchema, z.literal(0)]),
  ),
  predictedZeroAt: z.string().nullable(),
  lastObservedMinutes: z.number().nullable(),
  completedAt: z.string().nullable(),
});

const favoriteSchemaV3 = z.object({
  id: z.string(),
  name: z.string(),
  stop: stopReferenceSchema,
  lineAlerts: z.array(lineAlertSchemaV3),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastEnabledAt: z.string().nullable(),
});

const activeAlarmSchemaV3 = z.object({
  id: z.string(),
  stopCode: z.string(),
  stopName: z.string(),
  lineAlerts: z.array(activeLineAlertSchemaV3),
  armedAt: z.string(),
  completedAt: z.string().nullable(),
});

const storedStateSchemaV3 = z.object({
  version: z.literal(3),
  selectedStop: stopReferenceSchema.nullable(),
  lineAlerts: z.array(lineAlertSchemaV3),
  favorites: z.array(favoriteSchemaV3),
  activeAlarm: activeAlarmSchemaV3.nullable(),
});

const favoriteSchemaV2 = z.object({
  id: z.string(),
  name: z.string(),
  stop: stopReferenceSchema,
  lineIds: z.array(z.string()),
  optionalThresholds: z.array(optionalThresholdSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastEnabledAt: z.string().nullable(),
});

const activeAlarmSchemaV2 = z.object({
  id: z.string(),
  stopCode: z.string(),
  stopName: z.string(),
  selectedLineIds: z.array(z.string()),
  optionalThresholds: z.array(optionalThresholdSchema),
  firedThresholds: z.array(
    z.union([optionalThresholdSchema, z.literal(0)]),
  ),
  predictedZeroAt: z.string().nullable(),
  lastObservedLineId: z.string().nullable(),
  lastObservedMinutes: z.number().nullable(),
  armedAt: z.string(),
  completedAt: z.string().nullable().default(null),
});

const storedStateSchemaV2 = z.object({
  version: z.literal(2),
  selectedStop: stopReferenceSchema.nullable(),
  selectedLineIds: z.array(z.string()),
  optionalThresholds: z.array(optionalThresholdSchema),
  favorites: z.array(favoriteSchemaV2),
  activeAlarm: activeAlarmSchemaV2.nullable(),
});

export const DEFAULT_STORED_STATE: StoredState = {
  version: 4,
  selectedStop: null,
  subscriptions: [],
  favorites: [],
};

/** Creates a fresh subscription without guessing a physical vehicle. */
export function createSubscription(lineId: string): LineSubscription {
  return {
    lineId,
    trackedVehicleKey: null,
    firedOneMinute: false,
    predictedZeroAt: null,
    lastObservedMinutes: null,
    recentVehicles: [],
  };
}

function uniqueLineIds(lineIds: readonly string[]): string[] {
  return [...new Set(lineIds)];
}

function migrateFavoriteV3(
  favorite: z.infer<typeof favoriteSchemaV3>,
): Favorite {
  return {
    id: favorite.id,
    name: favorite.name,
    stop: favorite.stop,
    lineIds: uniqueLineIds(
      favorite.lineAlerts.map((lineAlert) => lineAlert.lineId),
    ),
    createdAt: favorite.createdAt,
    updatedAt: favorite.updatedAt,
    lastEnabledAt: favorite.lastEnabledAt,
  };
}

function migrateFavoriteV2(
  favorite: z.infer<typeof favoriteSchemaV2>,
): Favorite {
  return {
    id: favorite.id,
    name: favorite.name,
    stop: favorite.stop,
    lineIds: uniqueLineIds(favorite.lineIds),
    createdAt: favorite.createdAt,
    updatedAt: favorite.updatedAt,
    lastEnabledAt: favorite.lastEnabledAt,
  };
}

function migrateV3(
  state: z.infer<typeof storedStateSchemaV3>,
): StoredState {
  const subscriptions = state.activeAlarm?.completedAt
    ? []
    : (state.activeAlarm?.lineAlerts ?? [])
        .filter((lineAlert) => !lineAlert.completedAt)
        .map((lineAlert) => ({
          ...createSubscription(lineAlert.lineId),
          firedOneMinute: lineAlert.firedThresholds.includes(1),
          predictedZeroAt: lineAlert.predictedZeroAt,
          lastObservedMinutes: lineAlert.lastObservedMinutes,
        }));

  return {
    version: 4,
    selectedStop: state.selectedStop,
    subscriptions,
    favorites: state.favorites.map(migrateFavoriteV3),
  };
}

function migrateV2(
  state: z.infer<typeof storedStateSchemaV2>,
): StoredState {
  const alarm = state.activeAlarm;
  const subscriptions = !alarm || alarm.completedAt
    ? []
    : uniqueLineIds(alarm.selectedLineIds).map((lineId) => ({
        ...createSubscription(lineId),
        firedOneMinute:
          lineId === alarm.lastObservedLineId &&
          alarm.firedThresholds.includes(1),
        predictedZeroAt:
          lineId === alarm.lastObservedLineId
            ? alarm.predictedZeroAt
            : null,
        lastObservedMinutes:
          lineId === alarm.lastObservedLineId
            ? alarm.lastObservedMinutes
            : null,
      }));

  return {
    version: 4,
    selectedStop: state.selectedStop,
    subscriptions,
    favorites: state.favorites.map(migrateFavoriteV2),
  };
}

export function readStoredState(): StoredState {
  if (typeof window === "undefined") return DEFAULT_STORED_STATE;

  try {
    const currentRaw = window.localStorage.getItem(STORAGE_KEY);
    if (currentRaw) {
      const current = storedStateSchemaV4.safeParse(JSON.parse(currentRaw));
      return current.success ? current.data : DEFAULT_STORED_STATE;
    }

    const v3Raw = window.localStorage.getItem(V3_STORAGE_KEY);
    if (v3Raw) {
      const v3 = storedStateSchemaV3.safeParse(JSON.parse(v3Raw));
      return v3.success ? migrateV3(v3.data) : DEFAULT_STORED_STATE;
    }

    const v2Raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!v2Raw) return DEFAULT_STORED_STATE;
    const v2 = storedStateSchemaV2.safeParse(JSON.parse(v2Raw));
    return v2.success ? migrateV2(v2.data) : DEFAULT_STORED_STATE;
  } catch {
    return DEFAULT_STORED_STATE;
  }
}

export function writeStoredState(state: StoredState): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearStoredState(): void {
  window.localStorage.removeItem(STORAGE_KEY);
  window.localStorage.removeItem(V3_STORAGE_KEY);
  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  clearCachedArrivals();
}
