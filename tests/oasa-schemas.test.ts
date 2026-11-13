import { describe, expect, it } from "vitest";
import {
  arrivalsResponseSchema,
  routeDetailsResponseSchema,
  routesResponseSchema,
} from "@/lib/oasa/schemas";

describe("OASA schemas", () => {
  it("accepts numeric fields and hands back strings", () => {
    expect(
      arrivalsResponseSchema.parse([
        { route_code: 2484, veh_code: 12164, btime2: 3 },
      ]),
    ).toEqual([{ route_code: "2484", veh_code: "12164", btime2: "3" }]);

    const [route] = routesResponseSchema.parse([
      {
        RouteCode: 5751,
        hidden: 0,
        RouteDescr: "ΠΡΟΥΣΣΗΣ - ΑΒΕΡΩΦ",
        RouteType: 2,
        RouteDistance: 10200.72,
        LineID: "813",
        LineDescr: "ΑΒΕΡΩΦ - ΠΡΟΥΣΣΗΣ",
      },
    ])!;
    expect(route).toMatchObject({
      RouteCode: "5751",
      hidden: "0",
      RouteDistance: "10200.72",
    });

    const { stops } = routeDetailsResponseSchema.parse({
      stops: [
        {
          StopCode: 10183,
          StopID: "25",
          StopDescr: "ΠΕΙΡΑΙΑΣ",
          StopStreet: null,
          StopLat: 37.9384348,
          StopLng: 23.6318845,
          RouteStopOrder: 1,
          StopType: 0,
        },
      ],
    });
    expect(stops[0]).toMatchObject({
      StopCode: "10183",
      StopLat: "37.9384348",
      RouteStopOrder: "1",
    });
  });
});
