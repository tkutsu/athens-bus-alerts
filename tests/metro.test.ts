import { describe, expect, it } from "vitest";
import {
  INITIAL_APPROACH,
  approach,
  closestStation,
  describeLine,
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

describe("stationAt", () => {
  it("finds the nearest station on the line, past nearer ones on other lines", () => {
    expect(stationAt(north(-80), "M2", stations)).toBe(syntagma);
    expect(stationAt(north(-80), "T6", stations)).toBe(tramStop);
  });

  it("finds nothing beyond the chip radius or on a line with no station near", () => {
    expect(stationAt(north(350), "M2", stations)).toBeNull();
    expect(stationAt(ORIGIN, "M1", stations)).toBeNull();
  });
});

describe("describeLine", () => {
  it("names the mode and the number", () => {
    expect(describeLine("M1")).toBe("metro line 1");
    expect(describeLine("T6")).toBe("tram line 6");
  });
});

describe("closestStation", () => {
  it("finds the nearest station however far, and nothing without stations", () => {
    expect(closestStation(north(2_000), stations)?.station).toBe(panepistimio);
    expect(closestStation(ORIGIN, [])).toBeNull();
  });
});

describe("stickyClosest", () => {
  const onM2 = [syntagma, panepistimio];

  it("keeps the previous station until another is clearly nearer", () => {
    // Just past halfway, Panepistimio is nearer but only by 20 m.
    expect(stickyClosest(syntagma, north(460), onM2)?.station).toBe(syntagma);
    // Past the margin, it takes over.
    expect(stickyClosest(syntagma, north(480), onM2)?.station).toBe(panepistimio);
  });

  it("reports the kept station's own distance", () => {
    expect(stickyClosest(syntagma, north(460), onM2)?.meters).toBeCloseTo(460, -1);
  });

  it("lets go of a previous station once it isn't a candidate", () => {
    // The tram stop is nearer, but the rider has switched to M2.
    expect(stickyClosest(tramStop, north(-90), onM2)?.station).toBe(syntagma);
  });
});

/** Rides along the readings, collecting the station names announced. */
function ride(points: Coordinates[], state: ApproachState = INITIAL_APPROACH) {
  const headsUps: string[] = [];
  for (const point of points) {
    const result = approach(state, point, closestStation(point, [syntagma]));
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
