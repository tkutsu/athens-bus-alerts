"use client";

import { useSelectedLine } from "@/hooks/use-selected-line";
import { useStopCatalog } from "@/hooks/use-stop-catalog";
import { stationAt, type RailLine, type RailStation } from "@/lib/metro";
import type { CatalogStop } from "@/lib/stop-catalog";

export interface StopStation {
  line: RailLine;
  station: RailStation;
}

const stopsByCode = new WeakMap<readonly CatalogStop[], Map<string, CatalogStop>>();
const stationByStop = new WeakMap<readonly RailStation[], Map<string, StopStation | null>>();

/** Indexes each immutable catalogue snapshot once. */
function memo<K extends object, V>(cache: WeakMap<K, V>, key: K, build: () => V): V {
  let value = cache.get(key);
  if (!value) {
    value = build();
    cache.set(key, value);
  }
  return value;
}

/**
 * The station on the rider's line beside a stop, if any. Found by code, since
 * favorites keep only that.
 */
export function useStopStation(code: string): StopStation | null {
  const line = useSelectedLine();
  const { stops, stations } = useStopCatalog();
  if (!line || stations.length === 0) return null;

  const results = memo(stationByStop, stations, () => new Map<string, StopStation | null>());
  const key = `${line} ${code}`;
  if (results.has(key)) return results.get(key)!;

  const stop = memo(stopsByCode, stops, () =>
    new Map(stops.map((item) => [item.code, item])),
  ).get(code);
  if (!stop) return null;

  const station = stationAt(stop, line, stations);
  const result = station && { line, station };
  results.set(key, result);
  return result;
}
