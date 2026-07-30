import { describe, expect, it } from "vitest";
import { formatTransitName } from "@/lib/display";

describe("transit name formatting", () => {
  it("lowercases Latin and Greek names", () => {
    expect(formatTransitName("HSAP N. FALHROY")).toBe(
      "hsap n. falhroy",
    );
    expect(formatTransitName("ΠΛ. ΣΥΝΤΑΓΜΑΤΟΣ")).toBe(
      "πλ. συνταγματος",
    );
  });
});
