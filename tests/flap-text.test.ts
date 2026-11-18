import { describe, expect, it } from "vitest";
import { frame } from "@/components/flap-text";

describe("split-flap frames", () => {
  it("flips only the letters that change, in the target's script, then lands", () => {
    const from = [..."800 m"];
    const to = [..."790 m"];

    // The first slot has landed; the second, started 18 ms later, still flips.
    const early = frame(from, to, 250);
    expect(early.landed).toBe(false);
    expect(early.slots[0]).toBe("7");
    expect(early.slots[1]).toMatch(/\d/);
    expect(early.slots.slice(2).join("")).toBe("0 m");

    expect(frame(from, to, 1_000)).toEqual({ slots: to, landed: true });
  });

  it("ripples left to right and grows or shrinks to the new length", () => {
    const from = [..."Heading for"];
    const to = [..."συνταγμα"];

    const start = frame(from, to, 0);
    expect(start.slots[0]).toMatch(/[α-ω]/);
    expect(start.slots[10]).toBe("r");

    expect(frame(from, to, 1_000)).toEqual({ slots: to, landed: true });
    expect(frame(to, from, 1_000).slots.join("")).toBe("Heading for");
  });
});
