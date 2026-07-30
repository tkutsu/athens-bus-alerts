import { afterEach, describe, expect, it } from "vitest";
import {
  clearStoredState,
  LEGACY_STORAGE_KEY,
  readStoredState,
  STORAGE_KEY,
  writeStoredState,
} from "@/lib/storage";

afterEach(() => {
  window.localStorage.clear();
});

describe("stored state", () => {
  it("migrates v2 selections, favorites, and active alarms", () => {
    window.localStorage.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        selectedStop: { code: "400075", name: "HSAP N. FALHROY" },
        selectedLineIds: ["218", "500"],
        optionalThresholds: [5, 1],
        favorites: [
          {
            id: "favorite-1",
            name: "Home",
            stop: { code: "400075", name: "HSAP N. FALHROY" },
            lineIds: ["218"],
            optionalThresholds: [10, 3],
            createdAt: "2026-07-29T10:00:00.000Z",
            updatedAt: "2026-07-29T10:00:00.000Z",
            lastEnabledAt: null,
          },
        ],
        activeAlarm: {
          id: "alarm-1",
          stopCode: "400075",
          stopName: "HSAP N. FALHROY",
          selectedLineIds: ["218", "500"],
          optionalThresholds: [5, 1],
          firedThresholds: [5],
          predictedZeroAt: "2026-07-29T10:02:00.000Z",
          lastObservedLineId: "218",
          lastObservedMinutes: 2,
          armedAt: "2026-07-29T10:00:00.000Z",
          completedAt: null,
        },
      }),
    );

    const state = readStoredState();

    expect(state.version).toBe(3);
    expect(state.lineAlerts).toEqual([
      { lineId: "218", optionalThresholds: [5, 1] },
      { lineId: "500", optionalThresholds: [5, 1] },
    ]);
    expect(state.favorites[0].lineAlerts).toEqual([
      { lineId: "218", optionalThresholds: [10, 3] },
    ]);
    expect(state.activeAlarm?.lineAlerts).toEqual([
      expect.objectContaining({
        lineId: "218",
        firedThresholds: [5],
        predictedZeroAt: "2026-07-29T10:02:00.000Z",
        lastObservedMinutes: 2,
      }),
      expect.objectContaining({
        lineId: "500",
        firedThresholds: [5],
        predictedZeroAt: null,
        lastObservedMinutes: null,
      }),
    ]);
  });

  it("round-trips v3 and clears both storage generations", () => {
    const state = {
      version: 3 as const,
      selectedStop: { code: "400075", name: "HSAP N. FALHROY" },
      lineAlerts: [
        { lineId: "218", optionalThresholds: [10, 1] as const },
      ],
      favorites: [],
      activeAlarm: null,
    };

    writeStoredState({
      ...state,
      lineAlerts: state.lineAlerts.map((lineAlert) => ({
        ...lineAlert,
        optionalThresholds: [...lineAlert.optionalThresholds],
      })),
    });
    expect(readStoredState()).toEqual(state);

    window.localStorage.setItem(LEGACY_STORAGE_KEY, "{}");
    clearStoredState();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  });
});
