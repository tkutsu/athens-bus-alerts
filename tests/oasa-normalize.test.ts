import { describe, expect, it } from "vitest";
import { parseOasaTimestamp } from "@/lib/oasa/normalize";

describe("OASA timestamp normalization", () => {
  it("interprets summer telemetry in Europe/Athens rather than server time", () => {
    expect(
      new Date(parseOasaTimestamp("Aug  8 2026 11:53:37:000AM")).toISOString(),
    ).toBe("2026-08-08T08:53:37.000Z");
  });

  it("handles 12-hour boundaries", () => {
    expect(
      new Date(parseOasaTimestamp("Jan  8 2026 12:05:06:007AM")).toISOString(),
    ).toBe("2026-01-07T22:05:06.007Z");
  });
});
