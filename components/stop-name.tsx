"use client";

import { RailBadges } from "@/components/rail-badges";
import { useHiddenLines } from "@/hooks/use-hidden-lines";
import { useStopRail } from "@/hooks/use-stop-rail";
import { formatTransitName } from "@/lib/display";
import { isMetroLine } from "@/lib/metro";

/** A stop's name and the lines at it. The name truncates; the badges never do. */
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
      <RailBadges lines={lines} />
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
  const hiddenLines = useHiddenLines();
  const shown = station?.lines.filter((line) => !hiddenLines.has(line)) ?? [];
  if (!station || shown.length === 0) return null;

  const mode = shown.some(isMetroLine) ? "metro" : "tram";
  return (
    <span className="truncate">
      {separated && "· "}by {formatTransitName(station.name)} {mode}
    </span>
  );
}
