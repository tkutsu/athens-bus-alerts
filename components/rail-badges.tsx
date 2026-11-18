"use client";

import { FlipText } from "@/components/flip-text";
import { useClosestStation } from "@/hooks/use-closest-station";
import { selectLine, toggleLine, useSelectedLine } from "@/hooks/use-selected-line";
import { formatTransitName } from "@/lib/display";
import { formatDistance } from "@/lib/distance";
import { RAIL_LINES, describeLine, type RailLine } from "@/lib/metro";
import type { UserLocation } from "@/lib/types";

/** One line as station signs letter it, "M2" or "T6", set like a bus code. */
export function railBadgeClass(line: RailLine, off = false): string {
  return `rail-badge rail-line-${line.toLowerCase()}${off ? " rail-badge-off" : ""}`;
}

/** A line's badge, read out as `label`. */
export function LineBadge({
  line,
  label = describeLine(line),
}: {
  line: RailLine;
  label?: string;
}) {
  return (
    <>
      <span aria-hidden="true" className={railBadgeClass(line)}>
        {line}
      </span>
      <span className="sr-only">{label}</span>
    </>
  );
}

/** Within this, you're at the station rather than heading for it. */
const HERE_METERS = 100;

/** Rounds to 10 m so a few metres of GPS noise don't make the number flicker. */
function calmDistance(meters: number): string {
  return formatDistance(meters < 1_000 ? Math.round(meters / 10) * 10 : meters);
}

/**
 * Picks the line you're heading for. Once picked, the other lines fold away,
 * so your badge slides over beside a clear button that unfolds them again,
 * and the left side shows that line's closest station.
 */
export function RailLineFilter({
  location,
  onHeadsUp,
}: {
  location: UserLocation | null;
  onHeadsUp: (message: string) => void;
}) {
  const selected = useSelectedLine();
  const closest = useClosestStation(location, onHeadsUp);
  const isHere = closest !== null && closest.meters <= HERE_METERS;
  const station = closest && formatTransitName(closest.station.name);
  const distance = closest && (isHere ? "here" : calmDistance(closest.meters));

  return (
    <div aria-label="Line you're heading for" className="rail-filter" role="group">
      {/* "Heading for" flips over to the station, like a departure board. */}
      <p
        className={`rail-filter-label ${closest ? "rail-filter-station" : ""} ${
          isHere ? "rail-filter-here" : ""
        }`}
      >
        {station && (
          <span className="sr-only">
            Closest station: {station}, {distance}
          </span>
        )}
        <FlipText
          detail={distance ?? ""}
          detailValue={closest && !isHere ? closest.meters : null}
          title={station ?? "Heading for"}
        />
      </p>
      {/* All stay mounted, so the same badge morphs between the two states. */}
      {RAIL_LINES.map((line) => {
        const folded = selected !== null && line !== selected;
        return (
          <button
            aria-hidden={folded || undefined}
            aria-label={describeLine(line)}
            aria-pressed={line === selected}
            className={railBadgeClass(line, line !== selected)}
            data-folded={folded}
            inert={folded}
            key={line}
            onClick={() => toggleLine(line)}
            type="button"
          >
            {line}
          </button>
        );
      })}
      <button
        aria-hidden={!selected || undefined}
        aria-label={selected ? `Clear ${describeLine(selected)}` : "Clear line"}
        className="rail-filter-clear"
        data-folded={!selected}
        inert={!selected}
        onClick={(event) => {
          // This button folds away; your badge stays put, so focus goes there.
          event.currentTarget.parentElement
            ?.querySelector<HTMLElement>('[aria-pressed="true"]')
            ?.focus();
          selectLine(null);
        }}
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 10 10">
          <path d="M2 2l6 6M8 2l-6 6" />
        </svg>
      </button>
    </div>
  );
}
