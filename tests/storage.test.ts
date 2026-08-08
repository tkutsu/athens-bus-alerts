import { beforeEach, describe, expect, it } from "vitest";
import {
  clearStoredState,
  createSubscription,
  LEGACY_STORAGE_KEY,
  readStoredState,
  STORAGE_KEY,
  V4_STORAGE_KEY,
  V3_STORAGE_KEY,
  writeStoredState,
} from "@/lib/storage";
import { ARRIVAL_CACHE_KEY } from "@/lib/arrival-cache";

describe("stored state v5", () => {
  beforeEach(() => window.localStorage.clear());

  it("round-trips subscriptions and clears every storage generation", () => {
    const state = {
      version: 5 as const,
      selectedStop: { code: "400075", name: "HSAP N. FALHROY" },
      subscriptions: [createSubscription("218")],
      favorites: [
        {
          id: "favorite-1",
          name: "Home",
          stop: { code: "400075", name: "HSAP N. FALHROY" },
          routes: [
            { lineId: "218", routeCode: "2052" },
            { lineId: "500", routeCode: "2100" },
          ],
          createdAt: "2026-08-07T10:00:00.000Z",
          updatedAt: "2026-08-07T10:00:00.000Z",
          lastEnabledAt: null,
        },
      ],
    };

    writeStoredState(state);
    expect(readStoredState()).toEqual(state);

    window.localStorage.setItem(V3_STORAGE_KEY, "{}");
    window.localStorage.setItem(LEGACY_STORAGE_KEY, "{}");
    window.localStorage.setItem(ARRIVAL_CACHE_KEY, "{}");
    clearStoredState();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(V4_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(V3_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(ARRIVAL_CACHE_KEY)).toBeNull();
  });

  it("migrates v3 favorites and only incomplete active lines", () => {
    window.localStorage.setItem(
      V3_STORAGE_KEY,
      JSON.stringify({
        version: 3,
        selectedStop: { code: "400075", name: "HSAP N. FALHROY" },
        lineAlerts: [
          { lineId: "035", optionalThresholds: [10, 1] },
        ],
        favorites: [
          {
            id: "favorite-1",
            name: "Home",
            stop: { code: "400075", name: "HSAP N. FALHROY" },
            lineAlerts: [
              { lineId: "218", optionalThresholds: [10, 3, 1] },
              { lineId: "500", optionalThresholds: [1] },
            ],
            createdAt: "2026-08-07T10:00:00.000Z",
            updatedAt: "2026-08-07T10:00:00.000Z",
            lastEnabledAt: null,
          },
        ],
        activeAlarm: {
          id: "alarm-1",
          stopCode: "400075",
          stopName: "HSAP N. FALHROY",
          lineAlerts: [
            {
              lineId: "218",
              optionalThresholds: [10, 3, 1],
              firedThresholds: [10, 3, 1],
              predictedZeroAt: "2026-08-07T10:01:00.000Z",
              lastObservedMinutes: 1,
              completedAt: null,
            },
            {
              lineId: "500",
              optionalThresholds: [1],
              firedThresholds: [1, 0],
              predictedZeroAt: null,
              lastObservedMinutes: 0,
              completedAt: "2026-08-07T10:00:00.000Z",
            },
          ],
          armedAt: "2026-08-07T09:55:00.000Z",
          completedAt: null,
        },
      }),
    );

    const state = readStoredState();
    expect(state.version).toBe(5);
    expect(state.favorites[0].routes).toEqual([
      { lineId: "218", routeCode: null },
      { lineId: "500", routeCode: null },
    ]);
    expect(state.subscriptions).toHaveLength(1);
    expect(state.subscriptions[0]).toMatchObject({
      lineId: "218",
      firedOneMinute: true,
      trackedVehicleKey: null,
    });
    expect(state.subscriptions.some((item) => item.lineId === "035")).toBe(
      false,
    );
  });

  it("migrates a v4 tracked vehicle into its exact route direction", () => {
    window.localStorage.setItem(
      V4_STORAGE_KEY,
      JSON.stringify({
        version: 4,
        selectedStop: { code: "400075", name: "Stop" },
        subscriptions: [
          {
            lineId: "218",
            trackedVehicleKey: "2052:vehicle-1",
            firedOneMinute: false,
            predictedZeroAt: null,
            lastObservedMinutes: 4,
            recentVehicles: [],
          },
        ],
        favorites: [],
      }),
    );

    expect(readStoredState().subscriptions[0]).toMatchObject({
      lineId: "218",
      routeCode: "2052",
      firedLeaveNow: false,
    });
  });

  it("does not reactivate a completed v3 alarm", () => {
    window.localStorage.setItem(
      V3_STORAGE_KEY,
      JSON.stringify({
        version: 3,
        selectedStop: null,
        lineAlerts: [],
        favorites: [],
        activeAlarm: {
          id: "alarm-1",
          stopCode: "400075",
          stopName: "Stop",
          lineAlerts: [],
          armedAt: "2026-08-07T09:55:00.000Z",
          completedAt: "2026-08-07T10:00:00.000Z",
        },
      }),
    );

    expect(readStoredState().subscriptions).toEqual([]);
  });
});
