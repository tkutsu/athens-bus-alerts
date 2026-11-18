"use client";

import { useStopCatalog } from "@/hooks/use-stop-catalog";
import {
  linesNear,
  stationAt,
  type RailLine,
  type RailStation,
} from "@/lib/metro";
import type { CatalogStop } from "@/lib/stop-catalog";

interface StopRail {
  lines: RailLine[];
  station: RailStation | null;
}

const NO_RAIL: StopRail = { lines: [], station: null };

const stopsByCode = new WeakMap<readonly CatalogStop[], Map<string, CatalogStop>>();
const railByCode = new WeakMap<readonly RailStation[], Map<string, StopRail>>();

/** Indexes each immutable catalogue snapshot once. */
function memo<K extends object, V>(cache: WeakMap<K, V>, key: K, build: () => V): V {
  let value = cache.get(key);
  if (!value) {
    value = build();
    cache.set(key, value);
  }
  return value;
}

/** The metro and tram lines at a stop, found by code since favorites keep only that. */
export function useStopRail(code: string): StopRail {
  const { stops, stations } = useStopCatalog();
  if (stations.length === 0) return NO_RAIL;

  const results = memo(railByCode, stations, () => new Map<string, StopRail>());
  const cached = results.get(code);
  if (cached) return cached;

  const stop = memo(stopsByCode, stops, () =>
    new Map(stops.map((item) => [item.code, item])),
  ).get(code);
  if (!stop) return NO_RAIL;

  const rail = { lines: linesNear(stop, stations), station: stationAt(stop, stations) };
  results.set(code, rail);
  return rail;
}
