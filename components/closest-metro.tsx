"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RailBadges } from "@/components/rail-badges";
import { useHiddenLines } from "@/hooks/use-hidden-lines";
import { useStopCatalog } from "@/hooks/use-stop-catalog";
import { formatTransitName } from "@/lib/display";
import { formatDistance } from "@/lib/distance";
import {
  INITIAL_APPROACH,
  approach,
  isMetroLine,
  stickyClosest,
  type RailStation,
  type StationDistance,
} from "@/lib/metro";
import type { UserLocation } from "@/lib/types";
import { isUsableLocation } from "@/lib/walking";

/** Within this, you're at the station rather than heading for it. */
const HERE_METERS = 100;

/** Rounds to 10 m so a few metres of GPS noise don't make the number flicker. */
function calmDistance(meters: number): string {
  return formatDistance(meters < 1_000 ? Math.round(meters / 10) * 10 : meters);
}

function headsUpMessage({ station, meters }: StationDistance): string {
  const lines = station.lines.filter(isMetroLine);
  return `Metro coming up: ${formatTransitName(station.name)}, about ${formatDistance(
    Math.round(meters / 50) * 50,
  )} ahead. ${lines.length === 1 ? "Line" : "Lines"} ${lines.join(" and ")}.`;
}

/**
 * The nearest metro station while you have a good fix, and a one-time heads-up
 * as you approach one, early enough to plan getting off.
 */
export function ClosestMetro({
  location,
  onHeadsUp,
}: {
  location: UserLocation | null;
  onHeadsUp: (message: string) => void;
}) {
  const { stations: allStations } = useStopCatalog();
  const hiddenLines = useHiddenLines();
  // Only stations on a metro line the rider still shows; the same objects, so
  // the sticky choice keeps recognising its station.
  const stations = useMemo(
    () =>
      allStations.filter((station) =>
        station.lines.some((line) => isMetroLine(line) && !hiddenLines.has(line)),
      ),
    [allStations, hiddenLines],
  );
  const [closest, setClosest] = useState<StationDistance | null>(null);
  const [visible, setVisible] = useState(false);
  const previousRef = useRef<RailStation | null>(null);
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

    if (next && location) {
      const result = approach(approachRef.current, location, next);
      approachRef.current = result.state;
      if (result.headsUp) onHeadsUpRef.current(headsUpMessage(result.headsUp));
      setClosest(next);
    }
    // The last station stays rendered while the line collapses away.
    setVisible(next !== null);
  }, [location, stations]);

  const isHere = closest !== null && closest.meters <= HERE_METERS;

  return (
    <div
      aria-hidden={!visible}
      className="closest-metro"
      data-visible={visible}
    >
      {closest && (
        <p className={`closest-metro-line ${isHere ? "closest-metro-here" : ""}`}>
          <span className="sr-only">Closest metro: </span>
          <RailBadges
            label={(description) => `${description}, `}
            lines={closest.station.lines.filter(isMetroLine)}
          />
          <span className="truncate font-semibold">
            {formatTransitName(closest.station.name)}
          </span>
          <span className="shrink-0 tabular-nums">
            · {isHere ? "here" : calmDistance(closest.meters)}
          </span>
        </p>
      )}
    </div>
  );
}
