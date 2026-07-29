import { describe, expect, it } from "vitest";
import { dedupeArrivals } from "@/lib/arrivals";

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
