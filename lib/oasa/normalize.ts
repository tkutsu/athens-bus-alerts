import { dedupeArrivals } from "@/lib/arrivals";
import type {
  Arrival,
  RouteDetails,
  ServingRoute,
  VehicleTelemetry,
} from "@/lib/types";
import type {
  OasaArrival,
  OasaBusLocation,
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

const MONTHS = new Map(
  ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    .map((month, index) => [month, index]),
);

/** Parses OASA's non-standard wall-clock timestamp as Europe/Athens time. */
export function parseOasaTimestamp(value: string): number {
  const match = value.match(
    /^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2}):(\d{3})(AM|PM)$/,
  );
  if (!match) return Number.NaN;
  const [, monthName, day, year, rawHour, minute, second, milliseconds, period] = match;
  const month = MONTHS.get(monthName);
  if (month === undefined) return Number.NaN;
  const hour12 = Number(rawHour);
  const hour = (hour12 % 12) + (period === "PM" ? 12 : 0);
  const wallClockUtc = Date.UTC(
    Number(year),
    month,
    Number(day),
    hour,
    Number(minute),
    Number(second),
    Number(milliseconds),
  );
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Athens",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(wallClockUtc));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((entry) => entry.type === type)?.value);
  const athensWallClockAtUtc = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  const wallClockWholeSecond = wallClockUtc - Number(milliseconds);
  return wallClockUtc - (athensWallClockAtUtc - wallClockWholeSecond);
}

/** Normalizes ordered route geometry and stop direction metadata. */
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
      const heading = stop.StopHeading ? finiteNumber(stop.StopHeading) : null;
      return [{
        code: stop.StopCode,
        name: firstText(stop.StopDescr, stop.StopDescrEng),
        street: stop.StopStreet?.trim() || null,
        latitude,
        longitude,
        headingDegrees:
          heading !== null && heading >= 0 && heading < 360 ? heading : null,
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

/** Normalizes fresh-enough vehicle telemetry without exposing upstream formats. */
export function normalizeBusLocations(
  locations: OasaBusLocation[],
): VehicleTelemetry[] {
  return locations.flatMap((location) => {
    const latitude = finiteNumber(location.CS_LAT);
    const longitude = finiteNumber(location.CS_LNG);
    const timestamp = parseOasaTimestamp(location.CS_DATE);
    if (latitude === null || longitude === null || !Number.isFinite(timestamp)) {
      return [];
    }
    return [{
      routeCode: location.ROUTE_CODE,
      vehicleId: location.VEH_NO,
      latitude,
      longitude,
      recordedAt: new Date(timestamp).toISOString(),
    }];
  });
}
