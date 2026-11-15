import { describe, expect, it } from "vitest";
import { haversineMeters } from "@/lib/distance";
import {
  canReachBus,
  estimateWalkSeconds,
  isUsableLocation,
  reachMinutes,
} from "@/lib/walking";

const stop = { latitude: 37.9838, longitude: 23.7275 };
const nearby = { latitude: 37.9838, longitude: 23.7375 };

describe("estimateWalkSeconds", () => {
  it("applies the detour factor and walking speed to the crow-fly distance", () => {
    const meters = haversineMeters(stop, nearby);
    expect(estimateWalkSeconds(stop, nearby)).toBe(
      Math.ceil((meters * 1.3) / 1.25),
    );
  });

  it("never estimates below the 30-second floor", () => {
    expect(estimateWalkSeconds(stop, stop)).toBe(30);
  });
});

describe("isUsableLocation", () => {
  const precise = { ...stop, accuracyMeters: 20 };

  it("accepts a precise position", () => {
    expect(isUsableLocation(precise)).toBe(true);
  });

  it("rejects null and imprecise positions", () => {
    expect(isUsableLocation(null)).toBe(false);
    expect(isUsableLocation({ ...precise, accuracyMeters: 80 })).toBe(false);
  });
});

describe("canReachBus", () => {
  it("allows half a minute of slack against the walk", () => {
    expect(reachMinutes(330)).toBe(5);
    expect(canReachBus(5, 330)).toBe(true);
    expect(canReachBus(4.9, 330)).toBe(false);
  });

  it("treats an unknown location or a short walk as being at the stop", () => {
    expect(reachMinutes(undefined)).toBe(0);
    expect(reachMinutes(60)).toBe(0);
    expect(canReachBus(0, 60)).toBe(true);
  });
});
