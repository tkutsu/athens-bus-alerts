"use client";

import { useSyncExternalStore } from "react";
import { RAIL_LINES, type RailLine } from "@/lib/metro";

// Hidden rather than shown, so a line STASY adds later shows by default.
const STORAGE_KEY = "oasa-hidden-lines";
const CHANGE_EVENT = "oasa-hidden-lines-change";
const NONE: ReadonlySet<RailLine> = new Set();

let snapshot: { raw: string | null; lines: ReadonlySet<RailLine> } = {
  raw: null,
  lines: NONE,
};

function readStorage(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return snapshot.raw;
  }
}

/** Re-parses only when the stored text changes, so the snapshot stays stable. */
function getSnapshot(): ReadonlySet<RailLine> {
  const raw = readStorage();
  if (raw !== snapshot.raw) {
    const saved = raw?.split(" ") ?? [];
    snapshot = {
      raw,
      lines: new Set(RAIL_LINES.filter((line) => saved.includes(line))),
    };
  }
  return snapshot.lines;
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

/** Shows or hides one line's badges, map station and closest-metro readings. */
export function toggleLine(line: RailLine): void {
  const hidden = new Set(getSnapshot());
  if (hidden.has(line)) hidden.delete(line);
  else hidden.add(line);
  const raw = RAIL_LINES.filter((item) => hidden.has(item)).join(" ");
  try {
    window.localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // Without storage the choice still holds for this visit.
    snapshot = { raw, lines: new Set(RAIL_LINES.filter((item) => hidden.has(item))) };
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** The lines the rider has switched off; none until the page hydrates. */
export function useHiddenLines(): ReadonlySet<RailLine> {
  return useSyncExternalStore(subscribe, getSnapshot, () => NONE);
}
