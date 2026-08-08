import { describe, expect, it } from "vitest";
import { dedupeArrivals } from "@/lib/arrivals";
import {
  arrivalEntranceTiming,
  backwardJumpVehicleKeys,
  forwardJumpVehicleKeys,
  timelinePositionPercent,
  type TimelineArrival,
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
      expect(timing.delayMs + timing.tagDurationMs).toBeLessThanOrEqual(860);
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
  it("moves one twentieth of the rail for each elapsed minute", () => {
    const start = timelinePositionPercent(10, 0, 0);
    const afterOneMinute = timelinePositionPercent(10, 0, 60_000);

    expect(start).toBeCloseTo(50, 3);
    expect(afterOneMinute).toBeCloseTo(45, 3);
    expect(start - afterOneMinute).toBeCloseTo(100 / 20, 5);
  });

  it("reaches the stop after the current ETA and clamps distant buses", () => {
    expect(timelinePositionPercent(4, 0, 4 * 60_000)).toBe(0);
    expect(timelinePositionPercent(21, 0, 0)).toBe(100);
  });

  it("stays still beyond 20 minutes and starts at the 20-minute edge", () => {
    expect(timelinePositionPercent(24, 0, 3 * 60_000)).toBe(100);
    expect(timelinePositionPercent(24, 0, 4 * 60_000)).toBe(100);
    expect(
      timelinePositionPercent(24, 0, 4 * 60_000 + 15_000),
    ).toBeCloseTo(98.75, 3);
  });
});

describe("backwardJumpVehicleKeys", () => {
  it("only marks known physical buses whose ETA increased", () => {
    const arrivals: TimelineArrival[] = [
      {
        routeCode: "2810",
        vehicleId: "218-a",
        vehicleKey: "2810:218-a",
        lineId: "218",
        description: "Line 218",
        minutes: 7,
      },
      {
        routeCode: "5000",
        vehicleId: "500-a",
        vehicleKey: "5000:500-a",
        lineId: "500",
        description: "Line 500",
        minutes: 5,
      },
      {
        routeCode: "5000",
        vehicleId: "500-new",
        vehicleKey: "5000:500-new",
        lineId: "500",
        description: "Line 500",
        minutes: 9,
      },
    ];

    expect(
      [...backwardJumpVehicleKeys(
        new Map([
          ["2810:218-a", 4],
          ["5000:500-a", 6],
        ]),
        arrivals,
      )],
    ).toEqual(["2810:218-a"]);
  });

  it("detects a visual backtrack from an unchanged integer ETA", () => {
    const arrival: TimelineArrival = {
      routeCode: "2810",
      vehicleId: "218-a",
      vehicleKey: "2810:218-a",
      lineId: "218",
      description: "Line 218",
      minutes: 4,
    };

    expect(
      backwardJumpVehicleKeys(
        new Map([[arrival.vehicleKey, 4]]),
        [arrival],
        0.5,
      ).has(arrival.vehicleKey),
    ).toBe(true);
  });

  it("does not flip for a correction shorter than one marker", () => {
    const arrival: TimelineArrival = {
      routeCode: "2810",
      vehicleId: "218-a",
      vehicleKey: "2810:218-a",
      lineId: "218",
      description: "Line 218",
      minutes: 4,
    };

    expect(
      backwardJumpVehicleKeys(
        new Map([[arrival.vehicleKey, 4]]),
        [arrival],
        0.5,
        0.75,
      ),
    ).toEqual(new Set());
  });

  it("does not animate changes that remain beyond the 20-minute cutoff", () => {
    const arrival: TimelineArrival = {
      routeCode: "2810",
      vehicleId: "218-a",
      vehicleKey: "2810:218-a",
      lineId: "218",
      description: "Line 218",
      minutes: 23,
    };

    expect(
      backwardJumpVehicleKeys(
        new Map([[arrival.vehicleKey, 22]]),
        [arrival],
      ),
    ).toEqual(new Set());
  });
});

describe("forwardJumpVehicleKeys", () => {
  it("detects a fresh ETA that is ahead of the animated estimate", () => {
    const arrival: TimelineArrival = {
      routeCode: "2810",
      vehicleId: "218-a",
      vehicleKey: "2810:218-a",
      lineId: "218",
      description: "Line 218",
      minutes: 2,
    };

    expect(
      forwardJumpVehicleKeys(
        new Map([[arrival.vehicleKey, 4]]),
        [arrival],
        0.5,
      ).has(arrival.vehicleKey),
    ).toBe(true);
  });

  it("detects a bus crossing inward from the 20-minute cutoff", () => {
    const arrival: TimelineArrival = {
      routeCode: "2810",
      vehicleId: "218-a",
      vehicleKey: "2810:218-a",
      lineId: "218",
      description: "Line 218",
      minutes: 19,
    };

    expect(
      forwardJumpVehicleKeys(
        new Map([[arrival.vehicleKey, 22]]),
        [arrival],
      ).has(arrival.vehicleKey),
    ).toBe(true);
  });
});
