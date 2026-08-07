import { beforeEach, describe, expect, it } from "vitest";
import {
  ARRIVAL_CACHE_KEY,
  readCachedArrivals,
  writeCachedArrivals,
  type ArrivalsPayload,
} from "@/lib/arrival-cache";

function payload(vehicleId: string): ArrivalsPayload {
  return {
    arrivals: [{ routeCode: "2810", vehicleId, minutes: 4 }],
    observedAt: "2026-08-07T10:00:00.000Z",
  };
}

describe("arrival cache", () => {
  beforeEach(() => window.localStorage.clear());

  it("keeps independent schedules when the user changes stops", () => {
    writeCachedArrivals("400075", payload("first"), Date.UTC(2026, 7, 7, 10, 1));
    writeCachedArrivals("400076", payload("second"), Date.UTC(2026, 7, 7, 10, 2));

    expect(readCachedArrivals("400075")?.data.arrivals[0].vehicleId).toBe(
      "first",
    );
    expect(readCachedArrivals("400076")?.data.arrivals[0].vehicleId).toBe(
      "second",
    );
  });

  it("retains only the five most recently written stops", () => {
    for (let index = 0; index < 6; index += 1) {
      writeCachedArrivals(
        String(400_000 + index),
        payload(String(index)),
        Date.UTC(2026, 7, 7, 10, index),
      );
    }

    expect(readCachedArrivals("400000")).toBeNull();
    expect(readCachedArrivals("400005")).not.toBeNull();
    expect(
      JSON.parse(window.localStorage.getItem(ARRIVAL_CACHE_KEY) ?? "null")
        .entries,
    ).toHaveLength(5);
  });
});
