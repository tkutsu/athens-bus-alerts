import { z } from "zod";
import {
  OPTIONAL_THRESHOLDS,
  type StoredState,
} from "@/lib/types";

export const STORAGE_KEY = "athens-bus-ticker:v2";

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

const favoriteSchema = z.object({
  id: z.string(),
  name: z.string(),
  stop: stopReferenceSchema,
  lineIds: z.array(z.string()),
  optionalThresholds: z.array(optionalThresholdSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastEnabledAt: z.string().nullable(),
});

const activeAlarmSchema = z.object({
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
  version: z.literal(2),
  selectedStop: stopReferenceSchema.nullable(),
  selectedLineIds: z.array(z.string()),
  optionalThresholds: z.array(optionalThresholdSchema),
  favorites: z.array(favoriteSchema),
  activeAlarm: activeAlarmSchema.nullable(),
});

export const DEFAULT_STORED_STATE: StoredState = {
  version: 2,
  selectedStop: null,
  selectedLineIds: [],
  optionalThresholds: [...OPTIONAL_THRESHOLDS],
  favorites: [],
  activeAlarm: null,
};

export function readStoredState(): StoredState {
  if (typeof window === "undefined") {
    return DEFAULT_STORED_STATE;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_STORED_STATE;
    }

    const parsed = storedStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_STORED_STATE;
  } catch {
    return DEFAULT_STORED_STATE;
  }
}

export function writeStoredState(state: StoredState): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearStoredState(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}
