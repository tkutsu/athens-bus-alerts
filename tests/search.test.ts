import { describe, expect, it } from "vitest";
import {
  normalizeSearchText,
  transliterateGreek,
} from "@/lib/search";
import { searchStopNames } from "@/lib/stop-catalog";

describe("stop search normalization", () => {
  it("removes accents and normalizes spacing", () => {
    expect(normalizeSearchText("  Πλ.  Ομονοίας ")).toBe("πλ ομονοιας");
  });

  it("lets English input match Greek stop names", () => {
    expect(transliterateGreek("ΟΜΟΝΟΙΑ")).toBe("omonoia");
  });

  it("does not expose stop-code search", () => {
    const result = searchStopNames(
      [
        {
          code: "400075",
          name: "HSAP N. FALHROY",
          latitude: 37.9445913,
          longitude: 23.6671421,
        },
      ],
      "400075",
      { latitude: 37.9753, longitude: 23.7357 },
    );

    expect(result.total).toBe(0);
  });
});
