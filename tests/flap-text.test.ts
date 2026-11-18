import { describe, expect, it } from "vitest";
import { frame } from "@/components/flap-text";

describe("departure board frames", () => {
  it("turns each changed letter once, straight to the new one, one at a time", () => {
    const from = [..."800 m"];
    const to = [..."790 m"];

    // The unchanged letters don't hold up the second digit.
    expect(frame(from, to, 0)).toEqual({ slots: [..."700 m"], landed: false });
    expect(frame(from, to, 30)).toEqual({ slots: to, landed: true });
  });

  it("ripples left to right and grows or shrinks to the new length", () => {
    const from = [..."Heading for"];
    const to = [..."συνταγμα"];

    expect(frame(from, to, 0).slots.join("")).toBe("σeading for");
    expect(frame(from, to, 60).slots.join("")).toBe("συνding for");
    expect(frame(from, to, 1_000)).toEqual({ slots: to, landed: true });
    expect(frame(to, from, 1_000).slots.join("")).toBe("Heading for");
  });
});
