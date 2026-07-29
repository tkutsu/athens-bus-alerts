import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/nearby-stops/route";

describe("nearby stop API", () => {
  it("returns ten locally sorted stops", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/nearby-stops?lat=37.9753&lng=23.7357",
      ),
    );
    const payload = (await response.json()) as {
      stops: Array<{ distanceMeters: number }>;
    };

    expect(response.status).toBe(200);
    expect(payload.stops).toHaveLength(10);
    expect(
      payload.stops.every(
        (stop, index) =>
          index === 0 ||
          payload.stops[index - 1].distanceMeters <= stop.distanceMeters,
      ),
    ).toBe(true);
  });
});
