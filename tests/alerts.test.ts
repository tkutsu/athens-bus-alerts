import { describe, expect, it } from "vitest";
import { evaluateAlarm } from "@/lib/alerts";
import type { ActiveAlarm } from "@/lib/types";

function alarm(overrides: Partial<ActiveAlarm> = {}): ActiveAlarm {
  return {
    id: "alarm-1",
    stopCode: "400075",
    stopName: "ISAP N. FALIROU",
    selectedLineIds: ["218", "500"],
    optionalThresholds: [10, 5, 3, 1],
    firedThresholds: [],
    predictedZeroAt: null,
    lastObservedLineId: null,
    lastObservedMinutes: null,
    armedAt: "2026-07-29T10:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

describe("evaluateAlarm", () => {
  it("uses the earliest arrival among every selected line", () => {
    const result = evaluateAlarm(
      alarm(),
      [
        { lineId: "218", minutes: 8 },
        { lineId: "500", minutes: 5 },
        { lineId: "035", minutes: 1 },
      ],
      new Date("2026-07-29T10:00:00.000Z"),
    );

    expect(result.event).toMatchObject({
      kind: "warning",
      lineId: "500",
      threshold: 5,
      minutes: 5,
    });
  });

  it("runs an unrealized threshold when OASA reports below it", () => {
    const result = evaluateAlarm(
      alarm({ firedThresholds: [10] }),
      [{ lineId: "218", minutes: 4 }],
      new Date("2026-07-29T10:00:00.000Z"),
    );

    expect(result.event).toMatchObject({
      threshold: 5,
      minutes: 4,
    });
    expect(result.alarm?.firedThresholds).toEqual(
      expect.arrayContaining([10, 5]),
    );
  });

  it("uses the closest crossed threshold and avoids a notification burst", () => {
    const result = evaluateAlarm(
      alarm(),
      [{ lineId: "218", minutes: 2 }],
      new Date("2026-07-29T10:00:00.000Z"),
    );

    expect(result.event?.threshold).toBe(3);
    expect(result.alarm?.firedThresholds).toEqual(
      expect.arrayContaining([10, 5, 3]),
    );
  });

  it("always emits zero and keeps a completed alert for dismissal", () => {
    const result = evaluateAlarm(
      alarm({ firedThresholds: [10, 5, 3, 1] }),
      [{ lineId: "500", minutes: 0 }],
      new Date("2026-07-29T10:00:00.000Z"),
    );

    expect(result.event).toMatchObject({ kind: "zero", threshold: 0 });
    expect(result.alarm).toMatchObject({
      completedAt: "2026-07-29T10:00:00.000Z",
      lastObservedMinutes: 0,
      predictedZeroAt: null,
    });
  });

  it("uses the predicted zero time when the feed drops the bus", () => {
    const result = evaluateAlarm(
      alarm({
        firedThresholds: [10, 5, 3, 1],
        predictedZeroAt: "2026-07-29T10:01:00.000Z",
        lastObservedLineId: "218",
      }),
      [],
      new Date("2026-07-29T10:01:00.000Z"),
    );

    expect(result.event).toMatchObject({
      kind: "zero",
      lineId: "218",
    });
    expect(result.alarm?.completedAt).toBe(
      "2026-07-29T10:01:00.000Z",
    );
  });

  it("does not emit more events after completion", () => {
    const completed = alarm({
      completedAt: "2026-07-29T10:01:00.000Z",
      lastObservedMinutes: 0,
    });

    expect(
      evaluateAlarm(
        completed,
        [{ lineId: "218", minutes: 0 }],
        new Date("2026-07-29T10:02:00.000Z"),
      ),
    ).toEqual({ alarm: completed, event: null });
  });
});
