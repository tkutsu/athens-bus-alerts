"use client";

import { LineBadge } from "@/components/rail-badges";
import { useStopStation } from "@/hooks/use-stop-station";
import { formatTransitName } from "@/lib/display";
import { describeLine } from "@/lib/metro";

/**
 * A stop's name and, by default, the badge of the rider's line when a station
 * on it is close. The name truncates; the badge never does.
 */
export function StopName({
  code,
  name,
  prefix = "",
  className = "",
  badge = true,
}: {
  code: string;
  name: string;
  prefix?: string;
  className?: string;
  /** Off where a StopStationNote already names the station. */
  badge?: boolean;
}) {
  const nearby = useStopStation(code);

  return (
    <span className={`flex min-w-0 items-center gap-1.5 ${className}`}>
      <span className="truncate">
        {prefix}
        {formatTransitName(name)}
      </span>
      {badge && nearby && (
        <LineBadge label={`near ${describeLine(nearby.line)}`} line={nearby.line} />
      )}
    </span>
  );
}

/** Names the station on the rider's line beside a stop, such as "by σύνταγμα M2". */
export function StopStationNote({
  code,
  separated = false,
}: {
  code: string;
  /** Leads with a dot when other details come first. */
  separated?: boolean;
}) {
  const nearby = useStopStation(code);
  if (!nearby) return null;

  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="truncate">
        {separated && "· "}by {formatTransitName(nearby.station.name)}
      </span>
      <LineBadge label={`, ${describeLine(nearby.line)}`} line={nearby.line} />
    </span>
  );
}
