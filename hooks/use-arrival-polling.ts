"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  arrivalsPayloadSchema,
  readCachedArrivals,
  writeCachedArrivals,
  type ArrivalsPayload,
} from "@/lib/arrival-cache";
import { apiResponseError } from "@/lib/client-api";
import type { Arrival } from "@/lib/types";

const NEAR_POLL_INTERVAL_MS = 30_000;
const IMMINENT_POLL_INTERVAL_MS = 20_000;
const FAR_POLL_INTERVAL_MS = 60_000;
const ERROR_POLL_INTERVAL_MS = 20_000;
const RESUME_COALESCE_MS = 5_000;

/** Uses only selected routes to choose the next 20-, 30-, or 60-second cadence. */
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
  enabled = true,
) {
  const [data, setData] = useState<ArrivalsPayload | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const activeStopRef = useRef<string | null>(null);
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
        writeCachedArrivals(stopCode, dataRef.current, at, true);
      }
    },
    [stopCode],
  );

  const refresh = useCallback((minimumAgeMs = 0): Promise<void> => {
    if (!enabled || !stopCode || !navigator.onLine || document.hidden) {
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
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
        });
        if (!response.ok) {
          throw await apiResponseError(
            response,
            "Could not refresh live arrivals.",
          );
        }

        const payload = arrivalsPayloadSchema.parse(await response.json());
        if (controller.signal.aborted) return;
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
        setRetryAt(null);
        writeCachedArrivals(stopCode, payload, nextPollAt);
      } catch (refreshError) {
        if (!controller.signal.aborted) {
          const retryAt = Date.now() + ERROR_POLL_INTERVAL_MS;
          retryNotBeforeRef.current = retryAt;
          nextPollAtRef.current = retryAt;
          persistSchedule(retryAt);
          setRetryAt(retryAt);
          setError(
            refreshError instanceof Error
              ? refreshError
              : new Error("Could not refresh live arrivals."),
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
  }, [enabled, persistSchedule, stopCode]);

  /* eslint-disable react-hooks/set-state-in-effect -- restore the external arrival snapshot before scheduling */
  useEffect(() => {
    const changingStop = activeStopRef.current !== stopCode;
    activeStopRef.current = stopCode;
    if (changingStop) {
      setError(null);
      setRetryAt(null);
      lastRequestStartedAtRef.current = 0;
      retryNotBeforeRef.current = 0;
      const cached = stopCode ? readCachedArrivals(stopCode) : null;
      if (cached?.unavailable) {
        setError(new Error("Waiting for a fresh arrivals response."));
        setRetryAt(new Date(cached.nextPollAt).getTime());
      }
      dataRef.current = cached?.data ?? null;
      setData(cached?.data ?? null);
      nextPollAtRef.current = cached
        ? new Date(cached.nextPollAt).getTime()
        : Date.now();
    }
    setIsOffline(!navigator.onLine);
    setIsLoading(false);
    if (!stopCode) {
      dataRef.current = null;
      setData(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    if (!navigator.onLine) {
      setError(new Error("Waiting for a fresh arrivals response."));
    }

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
      if (!enabled || document.hidden || !navigator.onLine) return;
      await refresh(minimumAgeMs);
      if (!cancelled) schedule();
    };

    if (enabled) {
      if (nextPollAtRef.current > Date.now()) {
        schedule();
      } else {
        void runAndSchedule();
      }
    }

    const resume = (event: Event) => {
      setIsOffline(!navigator.onLine);
      if (!navigator.onLine) {
        setError((current) => current ?? new Error("Waiting for a fresh arrivals response."));
      } else if (event.type === "online") {
        nextPollAtRef.current = Math.max(Date.now(), retryNotBeforeRef.current);
      }
      if (!enabled || document.hidden || !navigator.onLine) {
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
  }, [enabled, refresh, stopCode]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return { data, error, isLoading, isOffline, retryAt };
}
