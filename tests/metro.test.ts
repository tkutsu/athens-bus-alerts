import { describe, expect, it } from "vitest";
import {
  INITIAL_APPROACH,
  approach,
  closestMetro,
  describeLines,
  linesNear,
  stationAt,
  stopsToLine,
  stickyClosest,
  type ApproachState,
  type RailStation,
} from "@/lib/metro";
import type { Coordinates, RouteDetails } from "@/lib/types";

const ORIGIN = { latitude: 37.9755, longitude: 23.7348 };
const METERS_PER_DEGREE = 111_195;

/** A point `meters` north of the origin. */
function north(meters: number): Coordinates {
  return {
    latitude: ORIGIN.latitude + meters / METERS_PER_DEGREE,
    longitude: ORIGIN.longitude,
  };
}

const syntagma: RailStation = { name: "ΣΥΝΤΑΓΜΑ", lines: ["M2", "M3"], ...ORIGIN };
const panepistimio: RailStation = { name: "ΠΑΝΕΠΙΣΤΗΜΙΟ", lines: ["M2"], ...north(900) };
const tramStop: RailStation = { name: "Ζάππειο", lines: ["T6"], ...north(-100) };
const stations = [syntagma, panepistimio, tramStop];

describe("stopsToLine", () => {
  const route: RouteDetails = {
    routeCode: "1", origin: "Start", destination: "End", isCircular: false,
    stops: [-1200, -900, -600, -350, 0, 900].map((meters, index) => ({
      code: String(index), name: "Stop", street: null,
      order: index * 10, ...north(meters),
    })),
  };

  it("counts actual stops to the first connection, even with gaps in order numbers", () => {
    expect(stopsToLine(route, "0", "M3", stations)).toBe(4);
    expect(stopsToLine(route, "3", "M3", stations)).toBe(1);
  });

  it("reports zero when the boarding stop already connects to the line", () => {
    expect(stopsToLine(route, "4", "M3", stations)).toBe(0);
  });

  it("ignores stations behind the boarding stop and other rail lines", () => {
    expect(stopsToLine(route, "5", "M3", stations)).toBeNull();
    expect(stopsToLine(route, "0", "M1", stations)).toBeNull();
    expect(stopsToLine(route, "missing", "M3", stations)).toBeNull();
  });

  it("uses the same connection radius for tram lines", () => {
    expect(stopsToLine(route, "0", "T6", stations)).toBe(3);
    expect(stopsToLine(route, "0", "T7", stations)).toBeNull();
  });
});

describe("linesNear", () => {
  it("merges lines from every station in range, metro before tram", () => {
    expect(linesNear(north(20), stations)).toEqual(["M2", "M3", "T6"]);
  });

  it("ignores stations beyond the chip radius", () => {
    expect(linesNear(north(350), stations)).toEqual([]);
  });
});

describe("stationAt", () => {
  it("prefers a metro station in range over a nearer tram stop", () => {
    expect(stationAt(north(-80), stations)).toBe(syntagma);
  });

  it("falls back to the tram, and to nothing out of range", () => {
    expect(stationAt(north(-100), [tramStop])).toBe(tramStop);
    expect(stationAt(north(400), stations)).toBeNull();
  });
});

describe("describeLines", () => {
  it("names each mode once, in chip order", () => {
    expect(describeLines(["M2", "M3", "T6"])).toBe(
      "metro lines 2 and 3 and tram line 6",
    );
    expect(describeLines(["M1"])).toBe("metro line 1");
  });
});

describe("closestMetro", () => {
  it("skips tram-only stops even when they are nearer", () => {
    expect(closestMetro(north(-90), stations)?.station).toBe(syntagma);
  });

  it("returns nothing without metro stations", () => {
    expect(closestMetro(ORIGIN, [tramStop])).toBeNull();
  });
});

describe("stickyClosest", () => {
  it("keeps the previous station until another is clearly nearer", () => {
    // Just past halfway, Panepistimio is nearer but only by 20 m.
    expect(stickyClosest(syntagma, north(460), stations)?.station).toBe(syntagma);
    // Past the margin, it takes over.
    expect(stickyClosest(syntagma, north(480), stations)?.station).toBe(panepistimio);
  });

  it("reports the kept station's own distance", () => {
    expect(stickyClosest(syntagma, north(460), stations)?.meters).toBeCloseTo(460, -1);
  });
});

/** Rides along the readings, collecting the station names announced. */
function ride(points: Coordinates[], state: ApproachState = INITIAL_APPROACH) {
  const headsUps: string[] = [];
  for (const point of points) {
    const result = approach(state, point, closestMetro(point, [syntagma]));
    state = result.state;
    if (result.headsUp) headsUps.push(result.headsUp.station.name);
  }
  return { headsUps, state };
}

describe("approach", () => {
  it("announces once, about 600 m out, while getting closer", () => {
    const { headsUps } = ride([north(-800), north(-590), north(-560), north(-530), north(-300)]);
    expect(headsUps).toEqual(["ΣΥΝΤΑΓΜΑ"]);
  });

  it("measures the approach from the furthest point, not the first", () => {
    // Drifting away then back counts once you're 50 m inside the furthest reading.
    expect(ride([north(-500), north(-560), north(-530)]).headsUps).toEqual([]);
    expect(ride([north(-500), north(-560), north(-505)]).headsUps).toEqual(["ΣΥΝΤΑΓΜΑ"]);
  });

  it("never announces while standing near a station", () => {
    expect(ride([north(-300), north(-305), north(-295), north(-300)]).headsUps).toEqual([]);
  });

  it("re-arms only after leaving the station 1 km behind", () => {
    const first = ride([north(-590), north(-530)]);
    expect(first.headsUps).toHaveLength(1);

    const looped = ride([north(-900), north(-590), north(-530)], first.state);
    expect(looped.headsUps).toEqual([]);

    const left = ride([north(-1_100), north(-590), north(-530)], first.state);
    expect(left.headsUps).toEqual(["ΣΥΝΤΑΓΜΑ"]);
  });
});
