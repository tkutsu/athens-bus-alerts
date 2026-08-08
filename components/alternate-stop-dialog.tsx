"use client";

import { useEffect, useRef } from "react";
import { formatTransitName } from "@/lib/display";
import type { BetterStopOption } from "@/lib/catch-options";
import type { StopSummary } from "@/lib/types";

function minutes(seconds: number) {
  return Math.max(1, Math.ceil(seconds / 60));
}

/** Confirms a better stop without silently changing the tracked location. */
export function AlternateStopDialog({
  currentStop,
  option,
  onClose,
  onConfirm,
}: {
  currentStop: StopSummary | null;
  option: BetterStopOption | null;
  onClose: () => void;
  onConfirm: (option: BetterStopOption) => void;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (option && !dialog.open) dialog.showModal();
    if (!option && dialog.open) dialog.close();
  }, [option]);

  return (
    <dialog
      aria-labelledby="alternate-stop-heading"
      className="favorites-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onClose={onClose}
      ref={ref}
    >
      {option && (
        <div className="favorites-sheet">
          <div className="flex items-center justify-between border-b border-ink/15 pb-3">
            <div>
              <p className="section-label text-signal">Better stop</p>
              <h2 className="mt-1 font-bold" id="alternate-stop-heading">
                Walk less, catch your bus
              </h2>
            </div>
            <button
              aria-label="Close better stop"
              className="flex size-10 items-center justify-center text-xl"
              onClick={onClose}
              type="button"
            >
              ×
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 py-4 text-sm">
            <div className="border border-ink/15 p-3">
              <p className="text-xs text-ink/50">Current</p>
              <p className="mt-1 font-semibold">
                {formatTransitName(currentStop?.name ?? "Current stop")}
              </p>
              <p className="mt-2">~{minutes(option.baseline.walkSeconds)}m walk</p>
              <p>{option.baseline.arrival.minutes}m bus</p>
            </div>
            <div className="border border-signal bg-signal/5 p-3">
              <p className="text-xs text-signal">Suggested</p>
              <p className="mt-1 font-semibold">
                {formatTransitName(option.stop.name)}
              </p>
              <p className="mt-2">~{minutes(option.walkSeconds)}m walk</p>
              <p>{option.arrival.minutes}m bus</p>
            </div>
          </div>
          <p className="text-xs text-ink/55">
            {option.sameVehicle
              ? "This is the same physical bus."
              : "A different bus on the same route arrives sooner."}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button className="secondary-button" onClick={onClose} type="button">
              Stay here
            </button>
            <button
              className="primary-button"
              onClick={() => onConfirm(option)}
              type="button"
            >
              Use this stop
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
