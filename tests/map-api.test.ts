import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/stops/map/route";

describe("map stop viewport API", () => {
  it("returns only stops inside the visible bounds", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/stops/map?north=37.99&south=37.97&east=23.75&west=23.70",
      ),
    );
    const payload = (await response.json()) as {
      stops: Array<{ latitude: number; longitude: number }>;
      total: number;
    };

    expect(response.status).toBe(200);
    expect(payload.total).toBeGreaterThan(0);
    expect(payload.stops.length).toBeLessThanOrEqual(400);
    expect(
      payload.stops.every(
        (stop) =>
          stop.latitude >= 37.97 &&
          stop.latitude <= 37.99 &&
          stop.longitude >= 23.7 &&
          stop.longitude <= 23.75,
      ),
    ).toBe(true);
  });

  it("rejects inverted bounds", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/stops/map?north=37&south=38&east=23&west=24",
      ),
    );

    expect(response.status).toBe(400);
  });
});
