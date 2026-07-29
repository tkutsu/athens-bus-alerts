import { haversineMeters } from "@/lib/distance";
import { dedupeArrivals } from "@/lib/arrivals";
import type {
  Arrival,
  Coordinates,
  ServingLine,
  ServingRoute,
  StopSummary,
} from "@/lib/types";
import type {
  OasaArrival,
  OasaClosestStop,
  OasaRoute,
  OasaStopDetails,
} from "@/lib/oasa/schemas";

function firstText(...values: Array<string | null | undefined>): string {
  return values.find((value) => value?.trim())?.trim() ?? "Unknown";
}

export function normalizeClosestStops(
  stops: OasaClosestStop[],
  origin: Coordinates,
  limit = 10,
): StopSummary[] {
  const unique = new Map<string, StopSummary>();

  for (const stop of stops) {
    const latitude = Number(stop.StopLat.replace(",", "."));
    const longitude = Number(stop.StopLng.replace(",", "."));

    if (
      !stop.StopCode ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      continue;
    }

    const normalized: StopSummary = {
      code: stop.StopCode.trim(),
      name: firstText(stop.StopDescrEng, stop.StopDescr),
      street:
        firstText(stop.StopStreetEng, stop.StopStreet) === "Unknown"
          ? null
          : firstText(stop.StopStreetEng, stop.StopStreet),
      latitude,
      longitude,
      distanceMeters: haversineMeters(origin, { latitude, longitude }),
    };

    const existing = unique.get(normalized.code);
    if (!existing || normalized.distanceMeters < existing.distanceMeters) {
      unique.set(normalized.code, normalized);
    }
  }

  return [...unique.values()]
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, limit);
}

export function normalizeStopDetails(
  stop: OasaStopDetails,
): Omit<StopSummary, "distanceMeters"> {
  return {
    code: stop.stop_id.trim(),
    name: firstText(stop.stop_descr_matrix_eng, stop.stop_descr),
    street: null,
    latitude: Number(stop.stop_lat.replace(",", ".")),
    longitude: Number(stop.stop_lng.replace(",", ".")),
  };
}

export function normalizeRoutes(routes: OasaRoute[]): {
  routes: ServingRoute[];
  lines: ServingLine[];
} {
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

  const normalizedRoutes = [...routesByCode.values()];
  const linesById = new Map<string, ServingLine>();

  for (const route of normalizedRoutes) {
    const existing = linesById.get(route.lineId);
    linesById.set(route.lineId, {
      lineId: route.lineId,
      description: existing?.description ?? route.description,
    });
  }

  return {
    routes: normalizedRoutes,
    lines: [...linesById.values()].sort((a, b) =>
      a.lineId.localeCompare(b.lineId, "en", { numeric: true }),
    ),
  };
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
