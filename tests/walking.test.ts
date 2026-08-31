import { describe, expect, it } from "vitest";
import { haversineMeters } from "@/lib/distance";
import { estimateWalkSeconds, isUsableLocation } from "@/lib/walking";

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
  const nowMs = Date.parse("2026-08-08T10:00:00.000Z");
  const fresh = {
    ...stop,
    accuracyMeters: 20,
    observedAt: "2026-08-08T09:59:30.000Z",
  };

  it("accepts a fresh, precise position", () => {
    expect(isUsableLocation(fresh, nowMs)).toBe(true);
  });

  it("rejects null, imprecise, and stale positions", () => {
    expect(isUsableLocation(null, nowMs)).toBe(false);
    expect(isUsableLocation({ ...fresh, accuracyMeters: 80 }, nowMs)).toBe(
      false,
    );
    expect(
      isUsableLocation(
        { ...fresh, observedAt: "2026-08-08T09:57:00.000Z" },
        nowMs,
      ),
    ).toBe(false);
  });
});
