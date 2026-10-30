"use client";

import { useEffect, useRef, useState } from "react";

const TOAST_DISMISS_MS = 5_000;

/** Shows one temporary, dismissible message above the app. */
export function Toast({
  isError,
  isUrgent,
  message,
  onDismiss,
}: {
  isError: boolean;
  isUrgent: boolean;
  message: string;
  onDismiss: () => void;
}) {
  const [visible, setVisible] = useState(true);
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setVisible(false);
      onDismissRef.current();
    }, TOAST_DISMISS_MS);
    return () => window.clearTimeout(timeout);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    onDismissRef.current();
  };

  return (
    <div
      aria-live={isError || isUrgent ? "assertive" : "polite"}
      className={`pointer-events-auto fixed top-4 left-1/2 z-[1000] flex w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 cursor-pointer items-start gap-3 overflow-hidden px-4 py-3 text-sm shadow-[0_16px_40px_rgb(0_0_0/0.32)] ${
        isError
          ? "border border-red-700/20 bg-[var(--toast-error)] text-[var(--toast-error-ink)]"
          : isUrgent
            ? "urgent-toast border-2 border-ink bg-signal font-bold text-white"
          : "border border-ink/15 bg-[var(--toast-neutral)] text-ink"
      }`}
      onClick={dismiss}
      role={isError || isUrgent ? "alert" : "status"}
    >
      <p className="min-w-0 flex-1">{message}</p>
      <button
        aria-label="Dismiss message"
        className="pointer-events-auto flex size-6 shrink-0 items-center justify-center text-current/70 hover:text-current"
        onClick={(event) => {
          event.stopPropagation();
          dismiss();
        }}
        type="button"
      >
        <span aria-hidden="true" className="text-lg leading-none">×</span>
      </button>
      <span
        aria-hidden="true"
        className={`toast-countdown absolute bottom-0 left-0 h-0.5 ${
          isError
            ? "bg-red-700/55"
            : isUrgent
              ? "bg-white/80"
              : "bg-signal/65"
        }`}
      />
    </div>
  );
}
