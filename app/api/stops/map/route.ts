import { NextResponse } from "next/server";
import stopCatalog from "@/data/stops.json";
import { apiError } from "@/lib/api";
import { haversineMeters } from "@/lib/distance";
import type { StopSummary } from "@/lib/types";

const MAX_VISIBLE_STOPS = 400;

/** Returns stops inside the visible map bounds. */
export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const north = Number(searchParams.get("north"));
  const south = Number(searchParams.get("south"));
  const east = Number(searchParams.get("east"));
  const west = Number(searchParams.get("west"));

  if (
    ![north, south, east, west].every(Number.isFinite) ||
    north <= south ||
    east <= west ||
    north > 90 ||
    south < -90 ||
    east > 180 ||
    west < -180
  ) {
    return apiError(400, "INVALID_INPUT", "Invalid map bounds.");
  }

  const center = {
    latitude: (north + south) / 2,
    longitude: (east + west) / 2,
  };
  const matches: StopSummary[] = [];

  for (const stop of stopCatalog.stops) {
    if (
      stop.latitude < south ||
      stop.latitude > north ||
      stop.longitude < west ||
      stop.longitude > east
    ) {
      continue;
    }

    matches.push({
      code: stop.code,
      name: stop.name,
      street: null,
      latitude: stop.latitude,
      longitude: stop.longitude,
      distanceMeters: haversineMeters(center, {
        latitude: stop.latitude,
        longitude: stop.longitude,
      }),
    });
  }

  matches.sort((a, b) => a.distanceMeters - b.distanceMeters);

  return NextResponse.json({
    stops: matches.slice(0, MAX_VISIBLE_STOPS),
    total: matches.length,
    truncated: matches.length > MAX_VISIBLE_STOPS,
  });
}
