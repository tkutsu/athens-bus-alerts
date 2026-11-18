"use client";

import { useEffect, useRef } from "react";
import { selectLine, useSelectedLine } from "@/hooks/use-selected-line";
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

/**
 * Picks the line you're heading for. Once picked, the row folds to that line
 * and a clear button, which brings the choices back.
 */
export function RailLineFilter() {
  const selected = useSelectedLine();
  const row = useRef<HTMLDivElement>(null);
  // The button you pressed leaves with the row's old shape, so focus moves to
  // the first one in the new shape. Map taps and favorites leave focus alone.
  const refocus = useRef(false);

  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    row.current?.querySelector("button")?.focus();
  }, [selected]);

  function choose(line: RailLine | null) {
    refocus.current = true;
    selectLine(line);
  }

  return (
    <div
      aria-label="Line you're heading for"
      className="rail-filter"
      ref={row}
      role="group"
    >
      <span aria-hidden="true" className="rail-filter-label">
        Heading for
      </span>
      {selected ? (
        <span className="rail-filter-choice" key={selected}>
          <LineBadge line={selected} />
          <button
            aria-label={`Clear ${describeLine(selected)}`}
            className="rail-filter-clear"
            onClick={() => choose(null)}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 10 10">
              <path d="M2 2l6 6M8 2l-6 6" />
            </svg>
          </button>
        </span>
      ) : (
        RAIL_LINES.map((line) => (
          <button
            aria-label={describeLine(line)}
            className={railBadgeClass(line, true)}
            key={line}
            onClick={() => choose(line)}
            type="button"
          >
            {line}
          </button>
        ))
      )}
    </div>
  );
}
