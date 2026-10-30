"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ApiRequestError } from "@/lib/client-api";

/** Keeps service failures visible without repeatedly announcing retry ticks. */
export function ServiceWarning({
  title,
  message,
  children,
  onDismiss,
  floating = false,
}: {
  title: string;
  message: ReactNode;
  children?: ReactNode;
  onDismiss?: () => void;
  floating?: boolean;
}) {
  return (
    <div className={`service-warning${floating ? " service-warning-floating" : ""}`}>
      <div className="flex items-start gap-2" role="alert" aria-atomic="true">
        <svg aria-hidden="true" className="service-warning-icon mt-0.5 size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 20 20">
          <path d="M10 2 19 18H1L10 2Z" strokeLinejoin="round" />
          <path d="M10 7v5m0 2v1" />
        </svg>
        <div className="min-w-0 flex-1">
          <p className="font-bold">{title}</p>
          <p className="mt-1">{message}</p>
        </div>
        {onDismiss && (
          <button
            aria-label="Dismiss arrival warning"
            className="flex size-6 shrink-0 items-center justify-center text-current/70 hover:text-current"
            onClick={onDismiss}
            type="button"
          >
            <span aria-hidden="true" className="text-lg leading-none">×</span>
          </button>
        )}
      </div>
      {children && <div className="mt-2 pl-6" aria-live="off">{children}</div>}
    </div>
  );
}

/** Shows the next retry and the age of the last successful arrivals snapshot. */
export function ArrivalWarning({
  error,
  isOffline,
  isRetrying,
  retryAt,
  observedAt,
  onDismiss,
}: {
  error: Error | null;
  isOffline: boolean;
  isRetrying: boolean;
  retryAt: number | null;
  observedAt: string | null;
  onDismiss: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const message = isOffline
    ? "You're offline. Live arrivals aren't updating."
    : error instanceof ApiRequestError && error.code === "OASA_UNAVAILABLE"
      ? "OASA isn't responding."
      : error instanceof ApiRequestError && error.code === "OASA_INVALID_RESPONSE"
        ? "OASA returned unusable data."
        : error
          ? "Couldn't refresh live arrivals."
          : "Live arrivals are out of date.";
  const seconds = retryAt ? Math.max(0, Math.ceil((retryAt - now) / 1_000)) : 0;
  const ageSeconds = observedAt
    ? Math.max(0, Math.floor((now - Date.parse(observedAt)) / 1_000))
    : null;

  return (
    <ServiceWarning
      floating
      title="Live arrivals unavailable"
      onDismiss={onDismiss}
      message={
        <>
          {message}{" "}
          <span aria-live="off">
            {isOffline
              ? "Updates will resume when you're back online."
              : isRetrying
                ? "Retrying..."
                : seconds > 0
                  ? `Retrying in ${seconds}s.`
                  : "Retrying..."}
          </span>
        </>
      }
    >
      {ageSeconds !== null && (
        <p className="mt-1">
          Last updated {ageSeconds < 60
            ? `${ageSeconds} seconds`
            : `${Math.floor(ageSeconds / 60)} ${ageSeconds < 120 ? "minute" : "minutes"}`} ago.
        </p>
      )}
    </ServiceWarning>
  );
}
