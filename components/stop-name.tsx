"use client";

import { MetroChips } from "@/components/metro-chips";
import { useStopRail } from "@/hooks/use-stop-rail";
import { formatTransitName } from "@/lib/display";
import { isMetroLine } from "@/lib/metro";

/** A stop's name and the lines at it. The name truncates; the chips never do. */
export function StopName({
  code,
  name,
  prefix = "",
  className = "",
}: {
  code: string;
  name: string;
  prefix?: string;
  className?: string;
}) {
  const { lines } = useStopRail(code);

  return (
    <span className={`flex min-w-0 items-center gap-1.5 ${className}`}>
      <span className="truncate">
        {prefix}
        {formatTransitName(name)}
      </span>
      <MetroChips lines={lines} />
    </span>
  );
}

/** Names the station a stop serves, such as "by σύνταγμα metro". */
export function StopStationNote({
  code,
  separated = false,
}: {
  code: string;
  /** Leads with a dot when other details come first. */
  separated?: boolean;
}) {
  const { station } = useStopRail(code);
  if (!station) return null;

  const mode = station.lines.some(isMetroLine) ? "metro" : "tram";
  return (
    <span className="metro-layer truncate">
      {separated && "· "}by {formatTransitName(station.name)} {mode}
    </span>
  );
}
