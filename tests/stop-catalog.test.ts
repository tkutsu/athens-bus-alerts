import { describe, expect, it } from "vitest";
import {
  findClosestStops,
  findStopsInBounds,
  searchStopNames,
  type CatalogStop,
} from "@/lib/stop-catalog";

const stops: CatalogStop[] = [
  {
    code: "1",
    name: "ΚΟΝΤΙΝΗ",
    latitude: 37.9754,
    longitude: 23.7357,
  },
  {
    code: "400075",
    name: "ΣΥΝΤΑΓΜΑ",
    latitude: 37.98,
    longitude: 23.74,
  },
  {
    code: "3",
    name: "ΜΑΚΡΙΝΗ",
    latitude: 38.1,
    longitude: 23.9,
  },
];

describe("client stop catalogue", () => {
  it("sorts nearby stops by distance", () => {
    const result = findClosestStops(
      stops,
      { latitude: 37.9753, longitude: 23.7357 },
      2,
    );

    expect(result.map((stop) => stop.code)).toEqual(["1", "400075"]);
    expect(result[0].distanceMeters).toBeLessThanOrEqual(
      result[1].distanceMeters,
    );
  });

  it("searches transliterated names but not internal codes", () => {
    const origin = { latitude: 37.9753, longitude: 23.7357 };

    expect(searchStopNames(stops, "syntagma", origin).stops[0].code).toBe(
      "400075",
    );
    expect(searchStopNames(stops, "400075", origin).total).toBe(0);
  });

  it("filters the catalogue to the visible map bounds", () => {
    const result = findStopsInBounds(stops, {
      north: 37.99,
      south: 37.97,
      east: 23.75,
      west: 23.72,
    });

    expect(result.stops.map((stop) => stop.code).sort()).toEqual([
      "1",
      "400075",
    ]);
    expect(result.truncated).toBe(false);
  });
});
