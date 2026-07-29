import { describe, expect, it } from "vitest";
import {
  normalizeSearchText,
  transliterateGreek,
} from "@/lib/search";
import { GET } from "@/app/api/stops/search/route";

describe("stop search normalization", () => {
  it("removes accents and normalizes spacing", () => {
    expect(normalizeSearchText("  Πλ.  Ομονοίας ")).toBe("πλ ομονοιας");
  });

  it("lets English input match Greek stop names", () => {
    expect(transliterateGreek("ΟΜΟΝΟΙΑ")).toBe("omonoia");
  });

  it("does not expose stop-code search", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/stops/search?q=400075&lat=37.9753&lng=23.7357",
      ),
    );
    const payload = (await response.json()) as { total: number };

    expect(response.status).toBe(200);
    expect(payload.total).toBe(0);
  });
});
