import { describe, expect, it } from "vitest";
import { updateVehicleConfidence } from "@/lib/vehicle-confidence";

describe("vehicle confidence", () => {
  it("keeps one recent ghost as unconfirmed", () => {
    const observedAt = "2026-08-08T10:00:00.000Z";
    const first = updateVehicleConfidence(
      new Map(),
      [{ routeCode: "10", vehicleId: "bus", minutes: 5 }],
      observedAt,
      Date.parse(observedAt),
    );
    const second = updateVehicleConfidence(
      first.records,
      [],
      "2026-08-08T10:00:30.000Z",
      Date.parse("2026-08-08T10:00:30.000Z"),
    );
    expect(second.arrivals[0].confidence).toBe("unconfirmed");
  });

  it("marks repeated two-minute ETA slippage with a turtle", () => {
    let records = new Map();
    let result;
    for (const [time, minutes] of [
      ["2026-08-08T10:00:00.000Z", 5],
      ["2026-08-08T10:01:00.000Z", 6],
      ["2026-08-08T10:02:00.000Z", 7],
      ["2026-08-08T10:02:30.000Z", 7],
    ] as const) {
      result = updateVehicleConfidence(
        records,
        [{ routeCode: "10", vehicleId: "bus", minutes }],
        time,
        Date.parse(time),
      );
      records = result.records;
    }
    expect(result!.arrivals[0].confidence).toBe("slipping");
  });
});
