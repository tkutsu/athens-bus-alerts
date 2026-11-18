"use client";

import { useSyncExternalStore } from "react";
import { RAIL_LINES, type RailLine } from "@/lib/metro";

// Store one selection; older multi-line preferences start with everything off.
const STORAGE_KEY = "oasa-selected-rail-line";
const CHANGE_EVENT = "oasa-hidden-lines-change";
const ALL: ReadonlySet<RailLine> = new Set(RAIL_LINES);

let snapshot: { raw: string | null; lines: ReadonlySet<RailLine> } = {
  raw: null,
  lines: ALL,
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
    snapshot = {
      raw,
      lines: new Set(RAIL_LINES.filter((line) => line !== raw)),
    };
  }
  return snapshot.lines;
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Selects just this line, or clears the selection when it is already on. */
export function toggleLine(line: RailLine): void {
  const raw = getSnapshot().has(line) ? line : "";
  try {
    window.localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // Without storage the choice still holds for this visit.
    snapshot = { raw, lines: new Set(RAIL_LINES.filter((item) => item !== raw)) };
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** All lines are off until the rider selects one. */
export function useHiddenLines(): ReadonlySet<RailLine> {
  return useSyncExternalStore(subscribe, getSnapshot, () => ALL);
}
