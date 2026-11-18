"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSelectedLine } from "@/hooks/use-selected-line";
import { useStopCatalog } from "@/hooks/use-stop-catalog";
import { formatTransitName } from "@/lib/display";
import { formatDistance } from "@/lib/distance";
import {
  INITIAL_APPROACH,
  approach,
  describeLine,
  stickyClosest,
  type RailLine,
  type StationDistance,
} from "@/lib/metro";
import type { UserLocation } from "@/lib/types";
import { isUsableLocation } from "@/lib/walking";

function headsUpMessage(line: RailLine, { station, meters }: StationDistance): string {
  const description = describeLine(line);
  return `${description[0].toUpperCase()}${description.slice(1)} coming up: ${formatTransitName(
    station.name,
  )}, about ${formatDistance(Math.round(meters / 50) * 50)} ahead.`;
}

/**
 * The nearest station on the rider's line while you have a good fix, and a
 * one-time heads-up as you approach one, early enough to plan getting off.
 */
export function useClosestStation(
  location: UserLocation | null,
  onHeadsUp: (message: string) => void,
): StationDistance | null {
  const { stations: allStations } = useStopCatalog();
  const line = useSelectedLine();
  // The same objects, so the sticky choice keeps recognising its station.
  const stations = useMemo(
    () => (line ? allStations.filter((station) => station.lines.includes(line)) : []),
    [allStations, line],
  );
  const [closest, setClosest] = useState<StationDistance | null>(null);
  const previousRef = useRef<StationDistance["station"] | null>(null);
  const approachRef = useRef(INITIAL_APPROACH);
  const onHeadsUpRef = useRef(onHeadsUp);

  useEffect(() => {
    onHeadsUpRef.current = onHeadsUp;
  }, [onHeadsUp]);

  useEffect(() => {
    const next = isUsableLocation(location)
      ? stickyClosest(previousRef.current, location, stations)
      : null;
    previousRef.current = next?.station ?? null;

    if (next && location && line) {
      const result = approach(approachRef.current, location, next);
      approachRef.current = result.state;
      if (result.headsUp) onHeadsUpRef.current(headsUpMessage(line, result.headsUp));
    }
    setClosest(next);
  }, [line, location, stations]);

  return line ? closest : null;
}
