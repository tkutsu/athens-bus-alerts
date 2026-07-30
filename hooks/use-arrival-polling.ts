"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiErrorPayload, Arrival } from "@/lib/types";

interface ArrivalsPayload {
  arrivals: Arrival[];
  observedAt: string;
}

const NEAR_POLL_INTERVAL_MS = 20_000;
const STANDARD_POLL_INTERVAL_MS = 30_000;
const FAR_POLL_INTERVAL_MS = 60_000;
const ERROR_POLL_INTERVAL_MS = 40_000;
const RESUME_COALESCE_MS = 5_000;
const ERROR_DISMISS_MS = 30_000;

/** Chooses the next successful poll interval from the earliest selected bus. */
export function arrivalPollInterval(
  arrivals: readonly Arrival[],
  selectedRouteCodes: readonly string[],
): number {
  const selectedRoutes = new Set(selectedRouteCodes);
  const earliestMinutes = arrivals.reduce(
    (earliest, arrival) =>
      selectedRoutes.has(arrival.routeCode)
        ? Math.min(earliest, arrival.minutes)
        : earliest,
    Number.POSITIVE_INFINITY,
  );

  if (!Number.isFinite(earliestMinutes)) return STANDARD_POLL_INTERVAL_MS;
  if (earliestMinutes <= 3) return NEAR_POLL_INTERVAL_MS;
  if (earliestMinutes <= 10) return STANDARD_POLL_INTERVAL_MS;
  return FAR_POLL_INTERVAL_MS;
}

async function readError(response: Response): Promise<string> {
  const value = (await response.json().catch(() => null)) as
    | ApiErrorPayload
    | null;
  return value?.error.message ?? "Could not refresh live arrivals.";
}

/** Polls one stop without overlapping requests and pauses while hidden/offline. */
export function useArrivalPolling(
  stopCode: string | null,
  selectedRouteCodes: readonly string[] = [],
) {
  const [data, setData] = useState<ArrivalsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [clock, setClock] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const lastRequestStartedAtRef = useRef(0);
  const retryNotBeforeRef = useRef(0);
  const nextPollAtRef = useRef(0);
  const selectedRouteCodesRef = useRef(selectedRouteCodes);

  useEffect(() => {
    selectedRouteCodesRef.current = selectedRouteCodes;
  }, [selectedRouteCodes]);

  const refresh = useCallback((minimumAgeMs = 0): Promise<void> => {
    if (!stopCode || !navigator.onLine || document.hidden) {
      return Promise.resolve();
    }

    if (inFlightRef.current) {
      return inFlightRef.current;
    }

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
          throw new Error(await readError(response));
        }

        const payload = (await response.json()) as ArrivalsPayload;
        const nextInterval = arrivalPollInterval(
          payload.arrivals,
          selectedRouteCodesRef.current,
        );
        retryNotBeforeRef.current = 0;
        nextPollAtRef.current = Date.now() + nextInterval;
        setData(payload);
        setError(null);
      } catch (refreshError) {
        if (
          !(refreshError instanceof DOMException) ||
          refreshError.name !== "AbortError"
        ) {
          const retryAt = Date.now() + ERROR_POLL_INTERVAL_MS;
          retryNotBeforeRef.current = retryAt;
          nextPollAtRef.current = retryAt;
          setError(
            refreshError instanceof Error
              ? refreshError.message
              : "Could not refresh live arrivals.",
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    })();
    const trackedRequest = request.finally(() => {
      if (inFlightRef.current === trackedRequest) {
        inFlightRef.current = null;
      }
    });
    inFlightRef.current = trackedRequest;
    return trackedRequest;
  }, [stopCode]);

  useEffect(() => {
    // Reset the previous stop's snapshot before starting its replacement poll.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(null);
    setError(null);

    if (!stopCode) {
      return;
    }

    let cancelled = false;
    lastRequestStartedAtRef.current = 0;
    retryNotBeforeRef.current = 0;
    nextPollAtRef.current = Date.now();

    const schedule = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      const delay = Math.max(0, nextPollAtRef.current - Date.now());
      timeoutRef.current = setTimeout(() => {
        void runAndSchedule();
      }, delay);
    };

    const runAndSchedule = async (minimumAgeMs = 0) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (document.hidden || !navigator.onLine) {
        return;
      }

      await refresh(minimumAgeMs);
      if (!cancelled) {
        schedule();
      }
    };

    void runAndSchedule();

    const resume = () => {
      if (!document.hidden && navigator.onLine) {
        void runAndSchedule(RESUME_COALESCE_MS);
      }
    };

    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);

    return () => {
      cancelled = true;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      controllerRef.current?.abort();
      inFlightRef.current = null;
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
    };
  }, [refresh, stopCode]);

  useEffect(() => {
    const updateClock = () => setClock(Date.now());
    updateClock();
    const interval = window.setInterval(updateClock, 15_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!error) return;

    // A prolonged OASA outage should not leave a stale error banner indefinitely.
    const timeout = window.setTimeout(() => setError(null), ERROR_DISMISS_MS);
    return () => window.clearTimeout(timeout);
  }, [error]);

  const stale =
    data !== null &&
    clock - new Date(data.observedAt).getTime() > 60_000;

  return { data, error, isLoading, stale };
}
