import { dedupeArrivals } from "@/lib/arrivals";
import type {
  Arrival,
  RouteDetails,
  ServingRoute,
} from "@/lib/types";
import type {
  OasaArrival,
  OasaRoute,
  OasaRouteDetails,
} from "@/lib/oasa/schemas";

function firstText(...values: Array<string | null | undefined>): string {
  return values.find((value) => value?.trim())?.trim() ?? "Unknown";
}

/** Extracts the final named endpoint while removing operational suffixes. */
export function routeDestination(description: string): string {
  const clean = description
    .replace(/\[[^\]]*]/g, "")
    .replace(/\([^)]*(?:express|κυκλικ|εναλλακ|temporary|detour)[^)]*\)/gi, "")
    .trim();
  return clean.split(/\s+-\s+/).at(-1)?.trim() || clean || "Unknown";
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
      descriptionEl: route.RouteDescr.trim(),
      descriptionEn: route.RouteDescrEng?.trim() || null,
      destination: routeDestination(route.RouteDescr),
      routeType: route.RouteType?.trim() || null,
      routeDistanceMeters: Number.isFinite(Number(route.RouteDistance))
        ? Number(route.RouteDistance)
        : null,
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

function finiteNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Normalizes ordered route geometry and stops. */
export function normalizeRouteDetails(
  routeCode: string,
  value: OasaRouteDetails,
): RouteDetails {
  const stops = value.stops
    .flatMap((stop) => {
      const latitude = finiteNumber(stop.StopLat);
      const longitude = finiteNumber(stop.StopLng);
      const order = finiteNumber(stop.RouteStopOrder);
      if (latitude === null || longitude === null || order === null) return [];
      return [{
        code: stop.StopCode,
        name: firstText(stop.StopDescr, stop.StopDescrEng),
        street: stop.StopStreet?.trim() || null,
        latitude,
        longitude,
        order,
      }];
    })
    .sort((a, b) => a.order - b.order);
  const shape = value.details
    .flatMap((point) => {
      const latitude = finiteNumber(point.routed_y);
      const longitude = finiteNumber(point.routed_x);
      const order = finiteNumber(point.routed_order);
      return latitude === null || longitude === null || order === null
        ? []
        : [{ latitude, longitude, order }];
    })
    .sort((a, b) => a.order - b.order);
  const first = stops[0];
  const last = stops.at(-1);

  return {
    routeCode,
    origin: first?.name ?? "Unknown",
    destination: last?.name ?? "Unknown",
    isCircular: Boolean(first && last && first.code === last.code),
    stops,
    shape,
  };
}
