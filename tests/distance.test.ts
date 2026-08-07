import { describe, expect, it } from "vitest";
import { haversineMeters } from "@/lib/distance";

describe("distance", () => {
  it("calculates distance in metres", () => {
    expect(
      haversineMeters(
        { latitude: 37.9838, longitude: 23.7275 },
        { latitude: 37.9833682, longitude: 23.7279031 },
      ),
    ).toBeGreaterThan(40);
  });
});
