"use client";

import { useEffect, useMemo, useState } from "react";
import type { Arrival, VehicleTelemetry } from "@/lib/types";

export interface RouteCatchState {
  observedAt: string;
  telemetryAvailable: boolean;
  unavailableStopCodes: string[];
  stopArrivals: Array<{ stopCode: string; arrivals: Arrival[] }>;
  vehicles: VehicleTelemetry[];
}

const POLL_MS = 30_000;
const EMPTY_CATCH_STATES = new Map<string, RouteCatchState>();

/** Polls route enrichments with a small concurrency cap and visibility awareness. */
export function useCatchPolling(
  candidatesByRoute: ReadonlyMap<string, readonly string[]>,
) {
  const [states, setStates] = useState<ReadonlyMap<string, RouteCatchState>>(
    new Map(),
  );
  const [error, setError] = useState<string | null>(null);
  const inputKey = useMemo(
    () =>
      [...candidatesByRoute.entries()]
        .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))
        .map(([routeCode, stops]) => `${routeCode}:${[...stops].sort().join(",")}`)
        .join("|"),
    [candidatesByRoute],
  );
  useEffect(() => {
    if (!inputKey) return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const controllers = new Set<AbortController>();

    const refresh = async () => {
      if (cancelled || document.hidden || !navigator.onLine) return;
      const entries = [...candidatesByRoute.entries()];
      const loaded = new Map<string, RouteCatchState>();
      let nextIndex = 0;

      const worker = async () => {
        while (!cancelled && nextIndex < entries.length) {
          const [routeCode, stopCodes] = entries[nextIndex++];
          const controller = new AbortController();
          controllers.add(controller);
          try {
            const query = new URLSearchParams({ stops: stopCodes.join(",") });
            const response = await fetch(
              `/api/routes/${routeCode}/catch-state?${query}`,
              { cache: "no-store", signal: controller.signal },
            );
            if (!response.ok) throw new Error("Could not check nearby stops.");
            loaded.set(routeCode, (await response.json()) as RouteCatchState);
          } finally {
            controllers.delete(controller);
          }
        }
      };

      try {
        await Promise.all([worker(), worker()]);
        if (!cancelled) {
          setStates((current) => new Map([...current, ...loaded]));
          setError(null);
        }
      } catch (pollError) {
        if (!cancelled) {
          setError(
            pollError instanceof Error
              ? pollError.message
              : "Could not check nearby stops.",
          );
        }
      } finally {
        if (!cancelled) timeout = setTimeout(() => void refresh(), POLL_MS);
      }
    };

    const resume = () => {
      if (document.hidden || !navigator.onLine) return;
      if (timeout) clearTimeout(timeout);
      void refresh();
    };
    void refresh();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
      controllers.forEach((controller) => controller.abort());
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [candidatesByRoute, inputKey]);

  return {
    states: inputKey ? states : EMPTY_CATCH_STATES,
    error: inputKey ? error : null,
  };
}
