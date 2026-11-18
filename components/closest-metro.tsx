"use client";

import { useEffect, useRef, useState } from "react";
import { MetroChips } from "@/components/metro-chips";
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
  const numbers = station.lines.filter(isMetroLine).map((line) => line.slice(1));
  return `Metro coming up: ${formatTransitName(station.name)}, about ${formatDistance(
    Math.round(meters / 50) * 50,
  )} ahead. ${numbers.length === 1 ? "Line" : "Lines"} ${numbers.join(" and ")}.`;
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
  const { stations } = useStopCatalog();
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
      // The approach still advances while switched off, so turning it on later
      // never replays a stale heads-up.
      if (result.headsUp && document.documentElement.dataset.metro !== "off") {
        onHeadsUpRef.current(headsUpMessage(result.headsUp));
      }
      setClosest(next);
    }
    // The last station stays rendered while the line collapses away.
    setVisible(next !== null);
  }, [location, stations]);

  const isHere = closest !== null && closest.meters <= HERE_METERS;

  return (
    <div
      aria-hidden={!visible}
      className="metro-layer closest-metro"
      data-visible={visible}
    >
      {closest && (
        <p className={`closest-metro-line ${isHere ? "closest-metro-here" : ""}`}>
          <span className="sr-only">Closest metro: </span>
          <MetroChips
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
