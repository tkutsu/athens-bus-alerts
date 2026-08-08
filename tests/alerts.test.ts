import { describe, expect, it } from "vitest";
import {
  evaluateSubscriptions,
  MAX_RECENT_VEHICLES,
  RECENT_VEHICLE_TTL_MS,
} from "@/lib/alerts";
import { createSubscription } from "@/lib/storage";
import type { LineSubscription } from "@/lib/types";

const NOW = new Date("2026-08-07T10:00:00.000Z");

function subscription(
  lineId: string,
  overrides: Partial<LineSubscription> = {},
): LineSubscription {
  return { ...createSubscription(lineId), ...overrides };
}

describe("evaluateSubscriptions", () => {
  it("tracks multiple selected lines independently", () => {
    const result = evaluateSubscriptions(
      [subscription("218"), subscription("500")],
      [
        { lineId: "218", vehicleKey: "2810:a", minutes: 1 },
        { lineId: "500", vehicleKey: "5000:b", minutes: 6 },
      ],
      NOW,
    );

    expect(result.events).toEqual([
      {
        kind: "one-minute",
        lineId: "218",
        vehicleKey: "2810:a",
        minutes: 1,
      },
    ]);
    expect(result.subscriptions[0]).toMatchObject({
      trackedVehicleKey: "2810:a",
      firedOneMinute: true,
    });
    expect(result.subscriptions[1]).toMatchObject({
      trackedVehicleKey: "5000:b",
      firedOneMinute: false,
    });
  });

  it("scopes tracking to one direction and fires walking time once", () => {
    const first = evaluateSubscriptions(
      [subscription("218", { routeCode: "2810" })],
      [
        {
          lineId: "218",
          routeCode: "2811",
          vehicleKey: "2811:wrong-way",
          minutes: 1,
          walkSeconds: 60,
        },
        {
          lineId: "218",
          routeCode: "2810",
          vehicleKey: "2810:right-way",
          minutes: 3,
          walkSeconds: 100,
        },
      ],
      NOW,
    );

    expect(first.subscriptions[0].trackedVehicleKey).toBe("2810:right-way");
    expect(first.events).toContainEqual({
      kind: "leave-now",
      lineId: "218",
      vehicleKey: "2810:right-way",
      minutes: 3,
    });
    const repeated = evaluateSubscriptions(
      first.subscriptions,
      [
        {
          lineId: "218",
          routeCode: "2810",
          vehicleKey: "2810:right-way",
          minutes: 3,
          walkSeconds: 100,
        },
      ],
      new Date(NOW.getTime() + 10_000),
    );
    expect(repeated.events.filter((event) => event.kind === "leave-now")).toEqual([]);
  });

  it("warns once and jumps directly to due-now without a warning", () => {
    const first = evaluateSubscriptions(
      [subscription("218")],
      [{ lineId: "218", vehicleKey: "2810:a", minutes: 1 }],
      NOW,
    );
    const repeated = evaluateSubscriptions(
      first.subscriptions,
      [{ lineId: "218", vehicleKey: "2810:a", minutes: 1 }],
      new Date(NOW.getTime() + 20_000),
    );
    const directZero = evaluateSubscriptions(
      [subscription("500")],
      [{ lineId: "500", vehicleKey: "5000:z", minutes: 0 }],
      NOW,
    );

    expect(repeated.events).toEqual([]);
    expect(directZero.events).toEqual([
      {
        kind: "zero",
        lineId: "500",
        vehicleKey: "5000:z",
        minutes: 0,
      },
    ]);
  });

  it("promotes the next same-code bus and suppresses the completed vehicle", () => {
    const result = evaluateSubscriptions(
      [
        subscription("218", {
          trackedVehicleKey: "2810:first",
          firedOneMinute: true,
          predictedZeroAt: NOW.toISOString(),
          lastObservedMinutes: 1,
        }),
      ],
      [
        { lineId: "218", vehicleKey: "2810:first", minutes: 0 },
        { lineId: "218", vehicleKey: "2810:next", minutes: 7 },
      ],
      NOW,
    );

    expect(result.events).toHaveLength(1);
    expect(result.subscriptions[0]).toMatchObject({
      lineId: "218",
      trackedVehicleKey: "2810:next",
      firedOneMinute: false,
      lastObservedMinutes: 7,
    });
    expect(result.subscriptions[0].recentVehicles[0].key).toBe(
      "2810:first",
    );

    const repeated = evaluateSubscriptions(
      result.subscriptions,
      [
        { lineId: "218", vehicleKey: "2810:first", minutes: 0 },
        { lineId: "218", vehicleKey: "2810:next", minutes: 6 },
      ],
      new Date(NOW.getTime() + 30_000),
    );
    expect(repeated.events).toEqual([]);
    expect(repeated.subscriptions[0].trackedVehicleKey).toBe("2810:next");
  });

  it("uses a missing vehicle prediction but discards stale predictions", () => {
    const active = subscription("218", {
      trackedVehicleKey: "2810:a",
      predictedZeroAt: new Date(NOW.getTime() - 60_000).toISOString(),
      lastObservedMinutes: 1,
    });
    const stale = subscription("500", {
      trackedVehicleKey: "5000:b",
      predictedZeroAt: new Date(NOW.getTime() - 180_000).toISOString(),
      lastObservedMinutes: 1,
    });
    const result = evaluateSubscriptions([active, stale], [], NOW);

    expect(result.events).toEqual([
      {
        kind: "zero",
        lineId: "218",
        vehicleKey: "2810:a",
        minutes: 0,
      },
    ]);
    expect(result.subscriptions[1].trackedVehicleKey).toBeNull();
  });

  it("prunes expired and excessive completion records", () => {
    const recentVehicles = Array.from(
      { length: MAX_RECENT_VEHICLES + 3 },
      (_, index) => ({
        key: `vehicle-${index}`,
        completedAt: new Date(NOW.getTime() - index * 1_000).toISOString(),
      }),
    );
    recentVehicles.unshift({
      key: "expired",
      completedAt: new Date(
        NOW.getTime() - RECENT_VEHICLE_TTL_MS - 1,
      ).toISOString(),
    });

    const result = evaluateSubscriptions(
      [subscription("218", { recentVehicles })],
      [],
      NOW,
    );

    expect(result.subscriptions[0].recentVehicles).toHaveLength(
      MAX_RECENT_VEHICLES,
    );
    expect(
      result.subscriptions[0].recentVehicles.some(
        (vehicle) => vehicle.key === "expired",
      ),
    ).toBe(false);
  });
});
