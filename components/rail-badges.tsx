"use client";

import { toggleLine, useSelectedLine } from "@/hooks/use-selected-line";
import { RAIL_LINES, describeLine, type RailLine } from "@/lib/metro";

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

/** Picks the line you're heading for; tapping it again clears the choice. */
export function RailLineFilter() {
  const selected = useSelectedLine();

  return (
    <div aria-label="Line you're heading for" className="rail-filter" role="group">
      <span aria-hidden="true" className="rail-filter-label">
        Heading for
      </span>
      {RAIL_LINES.map((line) => (
        <button
          aria-label={describeLine(line)}
          aria-pressed={line === selected}
          className={railBadgeClass(line, line !== selected)}
          key={line}
          onClick={() => toggleLine(line)}
          type="button"
        >
          {line}
        </button>
      ))}
    </div>
  );
}
