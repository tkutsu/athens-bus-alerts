import { z } from "zod";
import {
  type ActiveAlarm,
  type Favorite,
  type LineAlertConfig,
  type StoredState,
} from "@/lib/types";

export const STORAGE_KEY = "athens-bus-ticker:v3";
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

const lineAlertSchema = z.object({
  lineId: z.string(),
  optionalThresholds: z.array(optionalThresholdSchema),
});

const activeLineAlertSchema = lineAlertSchema.extend({
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
  lineAlerts: z.array(lineAlertSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastEnabledAt: z.string().nullable(),
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

const activeAlarmSchemaV3 = z.object({
  id: z.string(),
  stopCode: z.string(),
  stopName: z.string(),
  lineAlerts: z.array(activeLineAlertSchema),
  armedAt: z.string(),
  completedAt: z.string().nullable(),
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

const storedStateSchema = z.object({
  version: z.literal(3),
  selectedStop: stopReferenceSchema.nullable(),
  lineAlerts: z.array(lineAlertSchema),
  favorites: z.array(favoriteSchemaV3),
  activeAlarm: activeAlarmSchemaV3.nullable(),
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
  version: 3,
  selectedStop: null,
  lineAlerts: [],
  favorites: [],
  activeAlarm: null,
};

function migrateLineAlerts(
  lineIds: string[],
  optionalThresholds: LineAlertConfig["optionalThresholds"],
): LineAlertConfig[] {
  return lineIds.map((lineId) => ({
    lineId,
    optionalThresholds: [...optionalThresholds],
  }));
}

function migrateFavorite(
  favorite: z.infer<typeof favoriteSchemaV2>,
): Favorite {
  return {
    id: favorite.id,
    name: favorite.name,
    stop: favorite.stop,
    lineAlerts: migrateLineAlerts(
      favorite.lineIds,
      favorite.optionalThresholds,
    ),
    createdAt: favorite.createdAt,
    updatedAt: favorite.updatedAt,
    lastEnabledAt: favorite.lastEnabledAt,
  };
}

/** Preserves a v2 alarm without replaying warnings that already fired. */
function migrateActiveAlarm(
  alarm: z.infer<typeof activeAlarmSchemaV2>,
): ActiveAlarm {
  const completedAt = alarm.completedAt ?? null;
  return {
    id: alarm.id,
    stopCode: alarm.stopCode,
    stopName: alarm.stopName,
    lineAlerts: alarm.selectedLineIds.map((lineId) => ({
      lineId,
      optionalThresholds: [...alarm.optionalThresholds],
      firedThresholds: [...alarm.firedThresholds],
      predictedZeroAt:
        lineId === alarm.lastObservedLineId ? alarm.predictedZeroAt : null,
      lastObservedMinutes:
        lineId === alarm.lastObservedLineId
          ? alarm.lastObservedMinutes
          : null,
      completedAt,
    })),
    armedAt: alarm.armedAt,
    completedAt,
  };
}

function migrateStoredState(
  state: z.infer<typeof storedStateSchemaV2>,
): StoredState {
  return {
    version: 3,
    selectedStop: state.selectedStop,
    lineAlerts: migrateLineAlerts(
      state.selectedLineIds,
      state.optionalThresholds,
    ),
    favorites: state.favorites.map(migrateFavorite),
    activeAlarm: state.activeAlarm
      ? migrateActiveAlarm(state.activeAlarm)
      : null,
  };
}

export function readStoredState(): StoredState {
  if (typeof window === "undefined") {
    return DEFAULT_STORED_STATE;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = storedStateSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : DEFAULT_STORED_STATE;
    }

    const legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacyRaw) return DEFAULT_STORED_STATE;
    const legacy = storedStateSchemaV2.safeParse(JSON.parse(legacyRaw));
    return legacy.success
      ? migrateStoredState(legacy.data)
      : DEFAULT_STORED_STATE;
  } catch {
    return DEFAULT_STORED_STATE;
  }
}

export function writeStoredState(state: StoredState): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearStoredState(): void {
  window.localStorage.removeItem(STORAGE_KEY);
  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
}
