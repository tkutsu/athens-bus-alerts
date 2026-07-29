import { NextResponse } from "next/server";
import stopCatalog from "@/data/stops.json";
import { apiError, parseCoordinates } from "@/lib/api";
import { haversineMeters } from "@/lib/distance";
import type { StopSummary } from "@/lib/types";

/** Gets and distance-sorts the ten nearest stops from the local catalogue. */
export async function GET(request: Request) {
  const coordinates = parseCoordinates(new URL(request.url).searchParams);

  if (!coordinates) {
    return apiError(
      400,
      "INVALID_INPUT",
      "Choose a location within the OASA service area.",
    );
  }

  const stops: StopSummary[] = stopCatalog.stops
    .map((stop) => ({
      code: stop.code,
      name: stop.name,
      street: null,
      latitude: stop.latitude,
      longitude: stop.longitude,
      distanceMeters: haversineMeters(coordinates, stop),
    }))
    .sort(
      (a, b) =>
        a.distanceMeters - b.distanceMeters ||
        a.name.localeCompare(b.name, "el"),
    )
    .slice(0, 10);

  if (stops.length === 0) {
    return apiError(404, "NOT_FOUND", "No nearby OASA stops were found.");
  }

  return NextResponse.json({ stops });
}
