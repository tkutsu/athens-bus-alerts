"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LineBadge } from "@/components/rail-badges";
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
export function ClosestStation({
  location,
  onHeadsUp,
}: {
  location: UserLocation | null;
  onHeadsUp: (message: string) => void;
}) {
  const { stations: allStations } = useStopCatalog();
  const line = useSelectedLine();
  // The same objects, so the sticky choice keeps recognising its station.
  const stations = useMemo(
    () => (line ? allStations.filter((station) => station.lines.includes(line)) : []),
    [allStations, line],
  );
  const [shown, setShown] = useState<{ line: RailLine; closest: StationDistance } | null>(null);
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

    if (next && location && line) {
      const result = approach(approachRef.current, location, next);
      approachRef.current = result.state;
      if (result.headsUp) onHeadsUpRef.current(headsUpMessage(line, result.headsUp));
      setShown({ line, closest: next });
    }
    // The last station stays rendered while the line collapses away.
    setVisible(next !== null);
  }, [line, location, stations]);

  const isHere = shown !== null && shown.closest.meters <= HERE_METERS;

  return (
    <div
      aria-hidden={!visible}
      className="closest-station"
      data-visible={visible}
    >
      {shown && (
        <p className={`closest-station-line ${isHere ? "closest-station-here" : ""}`}>
          <span className="sr-only">Closest station: </span>
          <LineBadge label={`${describeLine(shown.line)}, `} line={shown.line} />
          <span className="truncate font-semibold">
            {formatTransitName(shown.closest.station.name)}
          </span>
          <span className="shrink-0 tabular-nums">
            · {isHere ? "here" : calmDistance(shown.closest.meters)}
          </span>
        </p>
      )}
    </div>
  );
}
