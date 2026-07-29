import { describe, expect, it } from "vitest";
import {
  normalizeSearchText,
  transliterateGreek,
} from "@/lib/search";

describe("stop search normalization", () => {
  it("removes accents and normalizes spacing", () => {
    expect(normalizeSearchText("  Πλ.  Ομονοίας ")).toBe("πλ ομονοιας");
  });

  it("lets English input match Greek stop names", () => {
    expect(transliterateGreek("ΟΜΟΝΟΙΑ")).toBe("omonoia");
  });
});
