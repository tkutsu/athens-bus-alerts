import { NextResponse } from "next/server";
import stopCatalog from "@/data/stops.json";
import { apiError, parseCoordinates } from "@/lib/api";
import { haversineMeters } from "@/lib/distance";
import { normalizeSearchText, transliterateGreek } from "@/lib/search";
import type { StopSummary } from "@/lib/types";

/** Searches the stop catalogue and sorts matches by distance. */
export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const coordinates = parseCoordinates(searchParams);
  const query = normalizeSearchText(searchParams.get("q") ?? "");

  if (!coordinates) {
    return apiError(
      400,
      "INVALID_INPUT",
      "Location is required so search results can be sorted by distance.",
    );
  }

  if (query.length < 2 && !/^\d+$/.test(query)) {
    return apiError(
      400,
      "INVALID_INPUT",
      "Enter at least two letters or a stop code.",
    );
  }

  const matches: StopSummary[] = [];

  for (const stop of stopCatalog.stops) {
    const searchable = [
      normalizeSearchText(stop.name),
      transliterateGreek(stop.name),
      normalizeSearchText(stop.code),
      normalizeSearchText(stop.publicCode),
    ].join(" ");

    if (!searchable.includes(query)) {
      continue;
    }

    matches.push({
      code: stop.code,
      name: stop.name,
      street: null,
      latitude: stop.latitude,
      longitude: stop.longitude,
      distanceMeters: haversineMeters(coordinates, {
        latitude: stop.latitude,
        longitude: stop.longitude,
      }),
    });
  }

  matches.sort(
    (a, b) =>
      a.distanceMeters - b.distanceMeters ||
      a.name.localeCompare(b.name, "el"),
  );

  return NextResponse.json({
    stops: matches.slice(0, 50),
    total: matches.length,
  });
}
