"use client";

import { toggleLine, useHiddenLines } from "@/hooks/use-hidden-lines";
import { RAIL_LINES, describeLines, type RailLine } from "@/lib/metro";

/** One line as station signs letter it, "M2" or "T6", set like a bus code. */
export function railBadgeClass(line: RailLine, off = false): string {
  return `rail-badge rail-line-${line.toLowerCase()}${off ? " rail-badge-off" : ""}`;
}

/** The lines at a place that the rider hasn't hidden; nothing if none remain. */
export function RailBadges({
  lines,
  label = (description) => `near ${description}`,
}: {
  lines: readonly RailLine[];
  label?: (description: string) => string;
}) {
  const hidden = useHiddenLines();
  const shown = lines.filter((line) => !hidden.has(line));
  if (shown.length === 0) return null;

  return (
    <span className="rail-badges">
      {shown.map((line) => (
        <span aria-hidden="true" className={railBadgeClass(line)} key={line}>
          {line}
        </span>
      ))}
      <span className="sr-only">{label(describeLines(shown))}</span>
    </span>
  );
}

/** Every line as a toggle: a hidden line fades here and disappears elsewhere. */
export function RailLineFilter() {
  const hidden = useHiddenLines();

  return (
    <div aria-label="Metro and tram lines" className="rail-filter" role="group">
      <span aria-hidden="true" className="rail-filter-label">
        Metro & tram
      </span>
      {RAIL_LINES.map((line) => (
        <button
          aria-label={describeLines([line])}
          aria-pressed={!hidden.has(line)}
          className={railBadgeClass(line, hidden.has(line))}
          key={line}
          onClick={() => toggleLine(line)}
          title={`${hidden.has(line) ? "Show" : "Hide"} ${line}`}
          type="button"
        >
          {line}
        </button>
      ))}
    </div>
  );
}
