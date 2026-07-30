import { describe, expect, it } from "vitest";
import { evaluateAlarm } from "@/lib/alerts";
import type {
  ActiveAlarm,
  ActiveLineAlert,
} from "@/lib/types";

function line(
  lineId: string,
  overrides: Partial<ActiveLineAlert> = {},
): ActiveLineAlert {
  return {
    lineId,
    optionalThresholds: [10, 5, 3, 1],
    firedThresholds: [],
    predictedZeroAt: null,
    lastObservedMinutes: null,
    completedAt: null,
    ...overrides,
  };
}

function alarm(overrides: Partial<ActiveAlarm> = {}): ActiveAlarm {
  return {
    id: "alarm-1",
    stopCode: "400075",
    stopName: "ISAP N. FALIROU",
    lineAlerts: [line("218"), line("500")],
    armedAt: "2026-07-29T10:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

describe("evaluateAlarm", () => {
  it("evaluates each selected line with its own thresholds", () => {
    const result = evaluateAlarm(
      alarm({
        lineAlerts: [
          line("218", { optionalThresholds: [10] }),
          line("500", { optionalThresholds: [5, 1] }),
        ],
      }),
      [
        { lineId: "218", minutes: 8 },
        { lineId: "500", minutes: 5 },
        { lineId: "035", minutes: 1 },
      ],
      new Date("2026-07-29T10:00:00.000Z"),
    );

    expect(result.events).toEqual([
      expect.objectContaining({
        lineId: "218",
        threshold: 10,
        minutes: 8,
      }),
      expect.objectContaining({
        lineId: "500",
        threshold: 5,
        minutes: 5,
      }),
    ]);
  });

  it("uses the closest crossed threshold without creating a burst", () => {
    const result = evaluateAlarm(
      alarm({ lineAlerts: [line("218")] }),
      [{ lineId: "218", minutes: 2 }],
      new Date("2026-07-29T10:00:00.000Z"),
    );

    expect(result.events).toEqual([
      expect.objectContaining({ lineId: "218", threshold: 3 }),
    ]);
    expect(result.alarm.lineAlerts[0].firedThresholds).toEqual(
      expect.arrayContaining([10, 5, 3]),
    );
  });

  it("completes one bus while keeping the others active", () => {
    const result = evaluateAlarm(
      alarm({
        lineAlerts: [
          line("218", { firedThresholds: [10, 5, 3, 1] }),
          line("500", { firedThresholds: [10] }),
        ],
      }),
      [
        { lineId: "218", minutes: 0 },
        { lineId: "500", minutes: 4 },
      ],
      new Date("2026-07-29T10:00:00.000Z"),
    );

    expect(result.events).toEqual([
      expect.objectContaining({
        kind: "zero",
        lineId: "218",
      }),
      expect.objectContaining({
        kind: "warning",
        lineId: "500",
        threshold: 5,
      }),
    ]);
    expect(result.alarm.lineAlerts[0].completedAt).not.toBeNull();
    expect(result.alarm.lineAlerts[1].completedAt).toBeNull();
    expect(result.alarm.completedAt).toBeNull();
  });

  it("completes the alarm only after every bus arrives", () => {
    const completedAt = "2026-07-29T09:59:00.000Z";
    const result = evaluateAlarm(
      alarm({
        lineAlerts: [
          line("218", { completedAt }),
          line("500", { firedThresholds: [10, 5, 3, 1] }),
        ],
      }),
      [{ lineId: "500", minutes: 0 }],
      new Date("2026-07-29T10:00:00.000Z"),
    );

    expect(result.alarm.completedAt).toBe(
      "2026-07-29T10:00:00.000Z",
    );
    expect(result.events).toEqual([
      expect.objectContaining({ lineId: "500", kind: "zero" }),
    ]);
  });

  it("uses each bus's predicted zero time when the feed drops it", () => {
    const result = evaluateAlarm(
      alarm({
        lineAlerts: [
          line("218", {
            firedThresholds: [10, 5, 3, 1],
            predictedZeroAt: "2026-07-29T10:01:00.000Z",
          }),
          line("500", {
            predictedZeroAt: "2026-07-29T10:05:00.000Z",
          }),
        ],
      }),
      [],
      new Date("2026-07-29T10:01:00.000Z"),
    );

    expect(result.events).toEqual([
      expect.objectContaining({ lineId: "218", kind: "zero" }),
    ]);
    expect(result.alarm.lineAlerts[1].completedAt).toBeNull();
  });

  it("does not emit more events after overall completion", () => {
    const completed = alarm({
      completedAt: "2026-07-29T10:01:00.000Z",
      lineAlerts: [
        line("218", {
          completedAt: "2026-07-29T10:01:00.000Z",
        }),
      ],
    });

    expect(
      evaluateAlarm(
        completed,
        [{ lineId: "218", minutes: 0 }],
        new Date("2026-07-29T10:02:00.000Z"),
      ),
    ).toEqual({ alarm: completed, events: [] });
  });
});
