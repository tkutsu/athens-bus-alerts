import { describe, expect, it } from "vitest";
import { haversineMeters } from "@/lib/distance";
import { normalizeClosestStops } from "@/lib/oasa/normalize";

describe("nearby stop ranking", () => {
  it("calculates distance in metres", () => {
    expect(
      haversineMeters(
        { latitude: 37.9838, longitude: 23.7275 },
        { latitude: 37.9833682, longitude: 23.7279031 },
      ),
    ).toBeGreaterThan(40);
  });

  it("deduplicates, sorts, and limits nearest results", () => {
    const stops = Array.from({ length: 12 }, (_, index) => ({
      StopCode: String(index === 11 ? 1 : index),
      StopDescr: `Stop ${index}`,
      StopDescrEng: null,
      StopStreet: null,
      StopStreetEng: null,
      StopLat: String(37.98 + index / 1_000),
      StopLng: "23.72",
    }));

    const result = normalizeClosestStops(
      stops,
      { latitude: 37.98, longitude: 23.72 },
      10,
    );

    expect(result).toHaveLength(10);
    expect(result[0].distanceMeters).toBeLessThanOrEqual(
      result[1].distanceMeters,
    );
    expect(new Set(result.map((stop) => stop.code)).size).toBe(10);
  });
});
