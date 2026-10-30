"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icon";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/** Shows the same white bus and orange background as the installed PWA. */
export function StartupScreen({
  exiting = false,
  onExited,
}: {
  exiting?: boolean;
  onExited?: () => void;
}) {
  return (
    <div
      aria-hidden={exiting || undefined}
      className={`startup-screen${exiting ? " startup-screen-exiting" : ""}`}
      onAnimationEnd={(event) => {
        if (exiting && event.target === event.currentTarget) onExited?.();
      }}
      role="status"
    >
      <Icon name="bus" className="startup-screen-bus" />
      <span className="sr-only">Loading My Pocket Bus: Athens</span>
    </div>
  );
}

/** Continues the native splash with a departure once the page is interactive. */
export function StartupSplash() {
  const [phase, setPhase] = useState<"waiting" | "departing" | "dismissed">("waiting");
  const hydrated = useSyncExternalStore(
    subscribe,
    clientSnapshot,
    serverSnapshot,
  );

  useEffect(() => {
    if (!hydrated || phase !== "waiting") return;
    let frame = 0;

    // Paint the centered bus before starting motion on the visible page.
    const scheduleDeparture = () => {
      window.cancelAnimationFrame(frame);
      if (document.visibilityState !== "visible") return;
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => {
          if (document.visibilityState === "visible") setPhase("departing");
        });
      });
    };

    document.addEventListener("visibilitychange", scheduleDeparture);
    scheduleDeparture();
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", scheduleDeparture);
    };
  }, [hydrated, phase]);

  useEffect(() => {
    if (phase !== "departing") return;
    // Remove the overlay even if the browser suppresses animation events.
    const timeout = window.setTimeout(() => setPhase("dismissed"), 750);
    return () => window.clearTimeout(timeout);
  }, [phase]);

  return phase === "dismissed" ? null : (
    <StartupScreen
      exiting={phase === "departing"}
      onExited={() => setPhase("dismissed")}
    />
  );
}
