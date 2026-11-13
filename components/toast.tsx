"use client";

import { useEffect, useRef, useState } from "react";
import { BusFace } from "@/components/bus-face";

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
  const tone = isError ? "error" : isUrgent ? "urgent" : "status";

  return (
    <div
      aria-live={isError || isUrgent ? "assertive" : "polite"}
      className={`toast toast-${tone}`}
      onClick={dismiss}
      role={isError || isUrgent ? "alert" : "status"}
    >
      <span aria-hidden="true" className="toast-badge">
        {isError ? <span className="toast-badge-mark">!</span> : <BusFace />}
      </span>
      <p className="toast-message">{message}</p>
      <button
        aria-label="Dismiss message"
        className="toast-dismiss"
        onClick={(event) => {
          event.stopPropagation();
          dismiss();
        }}
        type="button"
      >
        <span aria-hidden="true">×</span>
      </button>
      <span aria-hidden="true" className="toast-countdown" />
    </div>
  );
}
