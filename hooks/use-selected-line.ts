"use client";

import { useSyncExternalStore } from "react";
import { RAIL_LINES, type RailLine } from "@/lib/metro";

const STORAGE_KEY = "oasa-selected-rail-line";
const CHANGE_EVENT = "oasa-selected-line-change";

/** The last choice made here, for when storage is blocked. */
let fallback: string | null = null;

function getSnapshot(): RailLine | null {
  let raw = fallback;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Without storage the choice still holds for this visit.
  }
  return RAIL_LINES.find((line) => line === raw) ?? null;
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Picks this line, or clears the choice with null. */
export function selectLine(line: RailLine | null): void {
  fallback = line ?? "";
  try {
    window.localStorage.setItem(STORAGE_KEY, fallback);
  } catch {
    // The fallback keeps it.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Picks this line, or clears the choice when it is already picked. */
export function toggleLine(line: RailLine): void {
  selectLine(getSnapshot() === line ? null : line);
}

/** The line the rider is heading for; none until they pick one. */
export function useSelectedLine(): RailLine | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
