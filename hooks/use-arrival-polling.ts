"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  readCachedArrivals,
  writeCachedArrivals,
  type ArrivalsPayload,
} from "@/lib/arrival-cache";
import { apiErrorMessage, isAbortError } from "@/lib/client-api";
import type { Arrival } from "@/lib/types";

const NEAR_POLL_INTERVAL_MS = 30_000;
const IMMINENT_POLL_INTERVAL_MS = 20_000;
const FAR_POLL_INTERVAL_MS = 60_000;
const ERROR_POLL_INTERVAL_MS = 40_000;
const RESUME_COALESCE_MS = 5_000;
const ERROR_DISMISS_MS = 30_000;

/** Uses only selected routes to choose the next 30- or 60-second cadence. */
export function arrivalPollInterval(
  arrivals: readonly Arrival[],
  selectedRouteCodes: readonly string[],
): number {
  if (selectedRouteCodes.length === 0) return FAR_POLL_INTERVAL_MS;

  const selectedRoutes = new Set(selectedRouteCodes);
  const earliestMinutes = arrivals.reduce(
    (earliest, arrival) =>
      selectedRoutes.has(arrival.routeCode)
        ? Math.min(earliest, arrival.minutes)
        : earliest,
    Number.POSITIVE_INFINITY,
  );

  if (earliestMinutes < 2) return IMMINENT_POLL_INTERVAL_MS;
  return earliestMinutes <= 10 ? NEAR_POLL_INTERVAL_MS : FAR_POLL_INTERVAL_MS;
}

/** Reuses the persisted absolute schedule and never overlaps requests. */
export function useArrivalPolling(
  stopCode: string | null,
  selectedRouteCodes: readonly string[] = [],
) {
  const [data, setData] = useState<ArrivalsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const lastRequestStartedAtRef = useRef(0);
  const retryNotBeforeRef = useRef(0);
  const nextPollAtRef = useRef(0);
  const selectedRouteCodesRef = useRef(selectedRouteCodes);
  const dataRef = useRef<ArrivalsPayload | null>(null);

  useEffect(() => {
    // A selection affects the interval calculated after the existing timer fires.
    selectedRouteCodesRef.current = selectedRouteCodes;
  }, [selectedRouteCodes]);

  const persistSchedule = useCallback(
    (at: number) => {
      if (stopCode && dataRef.current) {
        writeCachedArrivals(stopCode, dataRef.current, at);
      }
    },
    [stopCode],
  );

  const refresh = useCallback((minimumAgeMs = 0): Promise<void> => {
    if (!stopCode || !navigator.onLine || document.hidden) {
      return Promise.resolve();
    }
    if (inFlightRef.current) return inFlightRef.current;

    const now = Date.now();
    if (
      now < retryNotBeforeRef.current ||
      now - lastRequestStartedAtRef.current < minimumAgeMs
    ) {
      return Promise.resolve();
    }

    lastRequestStartedAtRef.current = now;
    const controller = new AbortController();
    controllerRef.current = controller;

    const request = (async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/stops/${stopCode}/arrivals`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(
            await apiErrorMessage(
              response,
              "Could not refresh live arrivals.",
            ),
          );
        }

        const payload = (await response.json()) as ArrivalsPayload;
        const interval = arrivalPollInterval(
          payload.arrivals,
          selectedRouteCodesRef.current,
        );
        const nextPollAt = Date.now() + interval;
        retryNotBeforeRef.current = 0;
        nextPollAtRef.current = nextPollAt;
        dataRef.current = payload;
        setData(payload);
        setError(null);
        writeCachedArrivals(stopCode, payload, nextPollAt);
      } catch (refreshError) {
        if (!isAbortError(refreshError)) {
          const retryAt = Date.now() + ERROR_POLL_INTERVAL_MS;
          retryNotBeforeRef.current = retryAt;
          nextPollAtRef.current = retryAt;
          persistSchedule(retryAt);
          setError(
            refreshError instanceof Error
              ? refreshError.message
              : "Could not refresh live arrivals.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    })();

    const trackedRequest = request.finally(() => {
      if (inFlightRef.current === trackedRequest) {
        inFlightRef.current = null;
      }
    });
    inFlightRef.current = trackedRequest;
    return trackedRequest;
  }, [persistSchedule, stopCode]);

  /* eslint-disable react-hooks/set-state-in-effect -- restore the external arrival snapshot before scheduling */
  useEffect(() => {
    setError(null);
    if (!stopCode) {
      dataRef.current = null;
      setData(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    lastRequestStartedAtRef.current = 0;
    retryNotBeforeRef.current = 0;
    const cached = readCachedArrivals(stopCode);
    dataRef.current = cached?.data ?? null;
    setData(cached?.data ?? null);
    nextPollAtRef.current = cached
      ? new Date(cached.nextPollAt).getTime()
      : Date.now();

    const schedule = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      const delay = Math.max(0, nextPollAtRef.current - Date.now());
      timeoutRef.current = setTimeout(() => void runAndSchedule(), delay);
    };

    const runAndSchedule = async (minimumAgeMs = 0) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (document.hidden || !navigator.onLine) return;
      await refresh(minimumAgeMs);
      if (!cancelled) schedule();
    };

    if (nextPollAtRef.current > Date.now()) {
      schedule();
    } else {
      void runAndSchedule();
    }

    const resume = () => {
      if (document.hidden || !navigator.onLine) {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        return;
      }
      if (nextPollAtRef.current > Date.now()) {
        schedule();
      } else {
        void runAndSchedule(RESUME_COALESCE_MS);
      }
    };

    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    window.addEventListener("offline", resume);

    return () => {
      cancelled = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      controllerRef.current?.abort();
      inFlightRef.current = null;
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", resume);
    };
  }, [refresh, stopCode]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!error) return;
    const timeout = window.setTimeout(() => setError(null), ERROR_DISMISS_MS);
    return () => window.clearTimeout(timeout);
  }, [error]);

  return { data, error, isLoading };
}
