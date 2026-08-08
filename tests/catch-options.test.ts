import { describe, expect, it } from "vitest";
import {
  bestAlternateStop,
  catchOptionsForStop,
  representativeCatchOption,
} from "@/lib/catch-options";
import type { StopSummary, UserLocation } from "@/lib/types";

const location: UserLocation = {
  latitude: 37.98,
  longitude: 23.72,
  accuracyMeters: 12,
  observedAt: "2026-08-08T10:00:00.000Z",
};
const current: StopSummary = {
  code: "1",
  name: "Current",
  street: null,
  latitude: 37.982,
  longitude: 23.72,
  distanceMeters: 0,
};

describe("catch options", () => {
  it("uses the first safely catchable bus as the badge representative", () => {
    const options = catchOptionsForStop(
      current,
      [
        { routeCode: "10", vehicleId: "too-soon", minutes: 1 },
        { routeCode: "10", vehicleId: "catchable", minutes: 8 },
      ],
      location,
    );
    expect(representativeCatchOption(options)?.arrival.vehicleId).toBe(
      "catchable",
    );
  });

  it("offers a closer same-route stop only for a material improvement", () => {
    const baseline = {
      stop: current,
      arrival: { routeCode: "10", vehicleId: "bus", minutes: 8 },
      walkSeconds: 360,
      leaveInSeconds: 30,
      catchable: true,
    };
    const closer = {
      ...baseline,
      stop: { ...current, code: "2", name: "Closer" },
      walkSeconds: 180,
      leaveInSeconds: 210,
    };
    expect(bestAlternateStop(baseline, [closer])).toMatchObject({
      stop: { code: "2" },
      sameVehicle: true,
    });
    expect(
      bestAlternateStop(baseline, [
        { ...closer, walkSeconds: 300, leaveInSeconds: 90 },
      ]),
    ).toBeNull();
  });
});
