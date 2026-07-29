"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiErrorPayload, Arrival } from "@/lib/types";

interface ArrivalsPayload {
  arrivals: Arrival[];
  observedAt: string;
}

const POLL_INTERVAL_MS = 20_000;
const ERROR_DISMISS_MS = 30_000;

async function readError(response: Response): Promise<string> {
  const value = (await response.json().catch(() => null)) as
    | ApiErrorPayload
    | null;
  return value?.error.message ?? "Could not refresh live arrivals.";
}

/** Polls one stop without overlapping requests and pauses while hidden/offline. */
export function useArrivalPolling(stopCode: string | null) {
  const [data, setData] = useState<ArrivalsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [clock, setClock] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!stopCode || !navigator.onLine || document.hidden) {
      return;
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setIsLoading(true);

    try {
      const response = await fetch(`/api/stops/${stopCode}/arrivals`, {
        cache: "no-store",
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      setData((await response.json()) as ArrivalsPayload);
      setError(null);
    } catch (refreshError) {
      if (
        !(refreshError instanceof DOMException) ||
        refreshError.name !== "AbortError"
      ) {
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
  }, [stopCode]);

  useEffect(() => {
    // Reset the previous stop's snapshot before starting its replacement poll.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(null);
    setError(null);

    if (!stopCode) {
      return;
    }

    const schedule = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(async () => {
        await refresh();
        schedule();
      }, POLL_INTERVAL_MS);
    };

    void refresh().finally(schedule);

    const resume = () => {
      if (!document.hidden && navigator.onLine) {
        void refresh();
      }
    };

    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      controllerRef.current?.abort();
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

  return { data, error, isLoading, refresh, stale };
}
