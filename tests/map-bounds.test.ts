import { describe, expect, it } from "vitest";
import stopCatalog from "@/public/data/stops.json";
import { OASA_MAP_BOUNDS } from "@/components/stop-map";

describe("OASA map bounds", () => {
  it("include every stop with space around the catalogue edges", () => {
    const [[south, west], [north, east]] = OASA_MAP_BOUNDS;
    const latitudes = stopCatalog.stops.map((stop) => stop.latitude);
    const longitudes = stopCatalog.stops.map((stop) => stop.longitude);
    const stopSouth = Math.min(...latitudes);
    const stopNorth = Math.max(...latitudes);
    const stopWest = Math.min(...longitudes);
    const stopEast = Math.max(...longitudes);

    expect(stopSouth).toBeGreaterThan(south);
    expect(stopNorth).toBeLessThan(north);
    expect(stopWest).toBeGreaterThan(west);
    expect(stopEast).toBeLessThan(east);

    expect(stopSouth - south).toBeGreaterThan(0.01);
    expect(north - stopNorth).toBeGreaterThan(0.01);
    expect(stopWest - west).toBeGreaterThan(0.01);
    expect(east - stopEast).toBeGreaterThan(0.01);
  });
});
