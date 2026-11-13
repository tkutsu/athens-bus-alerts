import { describe, expect, it } from "vitest";
import { dedupeArrivals } from "@/lib/arrivals";
import {
  anchorMinutes,
  arrivalEntranceTiming,
  timelinePositionPercent,
  updateEtaAnchors,
} from "@/components/arrival-timeline";

describe("arrivalEntranceTiming", () => {
  it("varies entrances deterministically within the complete line draw", () => {
    // Representative vehicle keys prove both staggering and the hard 860ms cap.
    const timings = ["2810:218-a", "2810:218-b", "5000:500-a"].map(
      arrivalEntranceTiming,
    );

    expect(arrivalEntranceTiming("2810:218-a")).toEqual(timings[0]);
    expect(new Set(timings.map((timing) => timing.delayMs)).size).toBeGreaterThan(
      1,
    );
    expect(
      new Set(timings.map((timing) => timing.iconDurationMs)).size,
    ).toBeGreaterThan(1);
    for (const timing of timings) {
      expect(timing.delayMs).toBeGreaterThanOrEqual(280);
      expect(timing.delayMs + timing.iconDurationMs).toBeLessThanOrEqual(860);
      // Each tag waits for its circle's peak and settles soon after the line draw.
      expect(timing.tagDelayMs).toBe(
        timing.delayMs + Math.round(timing.iconDurationMs / 2),
      );
      expect(timing.tagDelayMs + timing.tagDurationMs).toBeLessThanOrEqual(
        860 + 300,
      );
      expect(timing.overshootScale).toBeGreaterThanOrEqual(1.22);
    }
  });
});

describe("dedupeArrivals", () => {
  it("keeps the earliest report for a repeated route and vehicle", () => {
    expect(
      dedupeArrivals([
        { routeCode: "4930", vehicleId: "71380", minutes: 7 },
        { routeCode: "4930", vehicleId: "71380", minutes: 5 },
        { routeCode: "4930", vehicleId: "90000", minutes: 9 },
      ]),
    ).toEqual([
      { routeCode: "4930", vehicleId: "71380", minutes: 5 },
      { routeCode: "4930", vehicleId: "90000", minutes: 9 },
    ]);
  });

  it("does not merge the same vehicle identifier across different routes", () => {
    expect(
      dedupeArrivals([
        { routeCode: "4930", vehicleId: "71380", minutes: 5 },
        { routeCode: "5000", vehicleId: "71380", minutes: 3 },
      ]),
    ).toHaveLength(2);
  });
});

describe("timelinePositionPercent", () => {
  it("moves one twentieth of the rail per minute and clamps at 20", () => {
    expect(timelinePositionPercent(10)).toBe(50);
    expect(timelinePositionPercent(9) - timelinePositionPercent(10)).toBe(-5);
    expect(timelinePositionPercent(24)).toBe(100);
    expect(timelinePositionPercent(-1)).toBe(0);
  });
});

describe("updateEtaAnchors", () => {
  const MINUTE = 60_000;
  const key = "2810:218-a";
  const step = (
    previous: Parameters<typeof updateEtaAnchors>[0],
    minutes: number,
    atMs: number,
  ) => updateEtaAnchors(previous, [{ vehicleKey: key, minutes }], atMs);

  it("keeps a bus rolling forward through a repeated report", () => {
    const first = step(new Map(), 5, 0);
    const second = step(first.anchors, 5, 20_000);
    const third = step(second.anchors, 5, 40_000);

    const shown = [0, 20_000, 40_000, 60_000].map((at) =>
      anchorMinutes((at < 20_000 ? first : at < 40_000 ? second : third).anchors.get(key)!, at),
    );
    for (let i = 1; i < shown.length; i++) expect(shown[i]).toBeLessThan(shown[i - 1]);
    expect(second.backward.size + third.backward.size).toBe(0);
  });

  it("eases off the further it runs ahead, and never backs up on repeats", () => {
    let anchors = step(new Map(), 5, 0).anchors;
    let previous = 5;
    for (let at = 20_000; at <= 600_000; at += 20_000) {
      const update = step(anchors, 5, at);
      anchors = update.anchors;
      const shown = anchorMinutes(anchors.get(key)!, at);
      expect(update.backward.size).toBe(0);
      expect(shown).toBeLessThanOrEqual(previous);
      previous = shown;
    }
    expect(anchors.get(key)!.rate).toBeLessThan(0.1);
    expect(previous).toBeGreaterThan(3);
  });

  it("jumps forward for a clearly sooner report", () => {
    const first = step(new Map(), 6, 0);
    const second = step(first.anchors, 4, 20_000);
    expect(second.forward.has(key)).toBe(true);
    expect(anchorMinutes(second.anchors.get(key)!, 20_000)).toBe(4);
  });

  it("jumps back only when the report is clearly further away", () => {
    const first = step(new Map(), 4, 0);
    const later = step(first.anchors, 7, MINUTE);
    expect(later.backward.get(key)).toBeCloseTo(3, 5);
    expect(anchorMinutes(later.anchors.get(key)!, MINUTE)).toBe(7);

    const small = step(first.anchors, 5, 20_000);
    expect(small.backward.size).toBe(0);
  });

  it("does not animate changes beyond the 20-minute edge", () => {
    const first = step(new Map(), 22, 0);
    const second = step(first.anchors, 26, MINUTE);
    expect(second.backward.size).toBe(0);
    expect(step(first.anchors, 19, MINUTE).forward.has(key)).toBe(true);
  });
});
