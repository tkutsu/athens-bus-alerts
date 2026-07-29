import { haversineMeters } from "@/lib/distance";
import {
  normalizeSearchText,
  transliterateGreek,
} from "@/lib/search";
import type { Coordinates, StopSummary } from "@/lib/types";

export interface CatalogStop extends Coordinates {
  code: string;
  name: string;
}

export interface StopCatalogPayload {
  generatedAt: string;
  source: string;
  stops: CatalogStop[];
}

export interface MapBounds {
  east: number;
  north: number;
  south: number;
  west: number;
}

/** Adds user-relative distance and UI fields to one catalogue stop. */
function summarizeStop(
  stop: CatalogStop,
  origin: Coordinates,
): StopSummary {
  return {
    ...stop,
    street: null,
    distanceMeters: haversineMeters(origin, stop),
  };
}

/** Returns the nearest catalogue stops without a server round trip. */
export function findClosestStops(
  stops: readonly CatalogStop[],
  origin: Coordinates,
  limit = 10,
): StopSummary[] {
  return stops
    .map((stop) => summarizeStop(stop, origin))
    .sort(
      (a, b) =>
        a.distanceMeters - b.distanceMeters ||
        a.name.localeCompare(b.name, "el"),
    )
    .slice(0, limit);
}

/** Searches stop names and sorts all matches relative to the user. */
export function searchStopNames(
  stops: readonly CatalogStop[],
  query: string,
  origin: Coordinates,
  limit = 50,
): { stops: StopSummary[]; total: number } {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length < 2) return { stops: [], total: 0 };

  const matches = stops
    .filter((stop) => {
      const name = normalizeSearchText(stop.name);
      return (
        name.includes(normalizedQuery) ||
        transliterateGreek(stop.name).includes(normalizedQuery)
      );
    })
    .map((stop) => summarizeStop(stop, origin))
    .sort(
      (a, b) =>
        a.distanceMeters - b.distanceMeters ||
        a.name.localeCompare(b.name, "el"),
    );

  return { stops: matches.slice(0, limit), total: matches.length };
}

/** Returns at most 400 stops inside the current Leaflet viewport. */
export function findStopsInBounds(
  stops: readonly CatalogStop[],
  bounds: MapBounds,
): { stops: StopSummary[]; truncated: boolean } {
  const center = {
    latitude: (bounds.north + bounds.south) / 2,
    longitude: (bounds.east + bounds.west) / 2,
  };
  const matches = stops
    .filter(
      (stop) =>
        stop.latitude >= bounds.south &&
        stop.latitude <= bounds.north &&
        stop.longitude >= bounds.west &&
        stop.longitude <= bounds.east,
    )
    .map((stop) => summarizeStop(stop, center))
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  return {
    stops: matches.slice(0, 400),
    truncated: matches.length > 400,
  };
}
