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

  it("skips a bus you can no longer walk to without alerting", () => {
    const first = evaluateSubscriptions(
      [subscription("218")],
      [
        { lineId: "218", vehicleKey: "2810:missed", minutes: 4, walkSeconds: 300 },
        { lineId: "218", vehicleKey: "2810:next", minutes: 9, walkSeconds: 300 },
      ],
      NOW,
    );
    expect(first.subscriptions[0].trackedVehicleKey).toBe("2810:next");
    expect(first.events).toEqual([]);

    const tracking = subscription("218", {
      trackedVehicleKey: "2810:slipped",
      predictedZeroAt: new Date(NOW.getTime() + 60_000).toISOString(),
      lastObservedMinutes: 1,
    });
    const handedOver = evaluateSubscriptions(
      [tracking],
      [
        { lineId: "218", vehicleKey: "2810:slipped", minutes: 1, walkSeconds: 300 },
        { lineId: "218", vehicleKey: "2810:next", minutes: 9, walkSeconds: 300 },
      ],
      NOW,
    );
    expect(handedOver.events).toEqual([]);
    expect(handedOver.subscriptions[0].trackedVehicleKey).toBe("2810:next");
  });

  it("still warns about every bus once you're at the stop", () => {
    const result = evaluateSubscriptions(
      [subscription("218")],
      [{ lineId: "218", vehicleKey: "2810:a", minutes: 1, walkSeconds: 30 }],
      NOW,
    );
    expect(result.events.map((event) => event.kind)).toContain("one-minute");
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

  it("calls a bus due as soon as a snapshot drops it two minutes out", () => {
    // OASA kept 892 at 2 min while it pulled in, then dropped it.
    const tracking = subscription("892", {
      trackedVehicleKey: "892r:a",
      predictedZeroAt: new Date(NOW.getTime() + 90_000).toISOString(),
      lastObservedMinutes: 2,
    });
    const result = evaluateSubscriptions([tracking], [], NOW);
    expect(result.events).toEqual([
      { kind: "zero", lineId: "892", vehicleKey: "892r:a", minutes: 0 },
    ]);
    expect(result.subscriptions[0].trackedVehicleKey).toBeNull();
  });

  it("does not call a bus due when a timer fires without a snapshot", () => {
    const tracking = subscription("218", {
      trackedVehicleKey: "2810:a",
      predictedZeroAt: new Date(NOW.getTime() + 50_000).toISOString(),
      lastObservedMinutes: 1,
    });
    const result = evaluateSubscriptions([tracking], null, NOW);
    expect(result.events).toEqual([]);
    expect(result.subscriptions[0].trackedVehicleKey).toBe("2810:a");
  });

  it("stays quiet about a bus dropped long after it was due", () => {
    const tracking = subscription("892", {
      trackedVehicleKey: "892r:a",
      predictedZeroAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
      lastObservedMinutes: 2,
    });
    const result = evaluateSubscriptions([tracking], [], NOW);
    expect(result.events).toEqual([]);
    expect(result.subscriptions[0].recentVehicles.map((v) => v.key)).toEqual(["892r:a"]);
  });

  it("never calls a bus due when it vanishes further out", () => {
    const tracking = subscription("218", {
      trackedVehicleKey: "2810:a",
      predictedLeaveAt: new Date(NOW.getTime() + 30_000).toISOString(),
      predictedZeroAt: new Date(NOW.getTime() + 180_000).toISOString(),
      lastObservedMinutes: 3,
    });
    const vanished = evaluateSubscriptions([tracking], [], NOW);
    expect(vanished.events).toEqual([]);
    expect(vanished.subscriptions[0].trackedVehicleKey).toBe("2810:a");

    // Neither the leave-now nor the due-now timer speaks for it afterwards.
    const later = new Date(NOW.getTime() + 240_000);
    const overdue = evaluateSubscriptions(vanished.subscriptions, null, later);
    expect(overdue.events).toEqual([]);
    expect(overdue.subscriptions[0].trackedVehicleKey).toBeNull();
  });

  it("keeps tracking a bus that drops out for a poll and comes back", () => {
    const tracking = subscription("218", {
      trackedVehicleKey: "2810:a",
      predictedZeroAt: new Date(NOW.getTime() + 240_000).toISOString(),
      lastObservedMinutes: 4,
    });
    const gone = evaluateSubscriptions([tracking], [], NOW);
    const back = evaluateSubscriptions(
      gone.subscriptions,
      [{ lineId: "218", vehicleKey: "2810:a", minutes: 0 }],
      new Date(NOW.getTime() + 30_000),
    );
    expect(back.events).toEqual([
      { kind: "zero", lineId: "218", vehicleKey: "2810:a", minutes: 0 },
    ]);
  });

  it("still sends leave-now from its timer between polls", () => {
    const tracking = subscription("218", {
      trackedVehicleKey: "2810:a",
      predictedLeaveAt: NOW.toISOString(),
      predictedZeroAt: new Date(NOW.getTime() + 300_000).toISOString(),
      lastObservedMinutes: 6,
    });
    const result = evaluateSubscriptions([tracking], null, NOW);
    expect(result.events).toEqual([
      { kind: "leave-now", lineId: "218", vehicleKey: "2810:a", minutes: 6 },
    ]);
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
