import { dedupeArrivals } from "@/lib/arrivals";
import type {
  Arrival,
  ServingRoute,
} from "@/lib/types";
import type {
  OasaArrival,
  OasaRoute,
} from "@/lib/oasa/schemas";

function firstText(...values: Array<string | null | undefined>): string {
  return values.find((value) => value?.trim())?.trim() ?? "Unknown";
}

export function normalizeRoutes(routes: OasaRoute[]): ServingRoute[] {
  const routesByCode = new Map<string, ServingRoute>();

  for (const route of routes) {
    if (route.hidden === "1") {
      continue;
    }

    routesByCode.set(route.RouteCode, {
      routeCode: route.RouteCode,
      lineId: route.LineID.trim(),
      description: firstText(route.RouteDescrEng, route.RouteDescr),
    });
  }

  return [...routesByCode.values()];
}

export function normalizeArrivals(arrivals: OasaArrival[]): Arrival[] {
  const normalized = arrivals
    .map((arrival) => ({
      routeCode: arrival.route_code,
      vehicleId: arrival.veh_code,
      minutes: Number.parseInt(arrival.btime2, 10),
    }))
    .filter(
      (arrival) =>
        arrival.routeCode &&
        arrival.vehicleId &&
        Number.isInteger(arrival.minutes) &&
        arrival.minutes >= 0,
    );

  return dedupeArrivals(normalized);
}
