"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { formatTransitName } from "@/lib/display";

export interface TimelineArrival {
  routeCode: string;
  vehicleId: string;
  vehicleKey: string;
  lineId: string;
  description: string;
  minutes: number;
}

interface ArrivalTimelineProps {
  arrivals: readonly TimelineArrival[];
  isLoading: boolean;
  observedAt: string | null;
  onToggleLine: (lineId: string) => void;
  selectedLineIds: readonly string[];
}

interface ArrivalSnapshot {
  observedAtMs: number;
  minutes: ReadonlyMap<string, number>;
}

const TIMELINE_MAX_MINUTES = 20;
const BUS_MARKER_SIZE_PX = 32;
const TIMELINE_VERTICAL_INSET_PX = 92;
const TIMELINE_TOP_INSET_PX = 20;
const TIMELINE_BOTTOM_INSET_PX = 72;
const CORRECTION_ANIMATION_MS = 1_050;
const LINE_ENTRANCE_START_MS = 280;
const LINE_ENTRANCE_END_MS = 860;

export interface ArrivalEntranceTiming {
  delayMs: number;
  iconDurationMs: number;
  overshootScale: number;
  tagDurationMs: number;
}

function BusIcon() {
  return (
    <svg
      className="arrival-timeline-bus-icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <rect x="4" y="3" width="16" height="16" rx="2" />
      <path d="M8 6v6m8-6v6M6 17h12M7 21v-2m10 2v-2" />
      <path d="M8 15h.01M16 15h.01" />
    </svg>
  );
}

/** Produces stable staggered timing without allowing entrances past the line draw. */
export function arrivalEntranceTiming(
  vehicleKey: string,
): ArrivalEntranceTiming {
  const hash = (salt: number) => {
    let value = 2_166_136_261 ^ salt;
    for (const character of vehicleKey) {
      value ^= character.charCodeAt(0);
      value = Math.imul(value, 16_777_619);
    }
    return value >>> 0;
  };
  const iconDurationMs = 260 + (hash(1) % 101);
  const latestStartMs = LINE_ENTRANCE_END_MS - iconDurationMs;
  const delayMs =
    LINE_ENTRANCE_START_MS +
    (hash(2) % (latestStartMs - LINE_ENTRANCE_START_MS + 1));

  return {
    delayMs,
    iconDurationMs,
    overshootScale: 1.22 + (hash(3) % 13) / 100,
    tagDurationMs: 180 + (hash(4) % 81),
  };
}

/** Maps one minute of elapsed time to exactly one minute of rail travel. */
export function timelinePositionPercent(
  reportedMinutes: number,
  observedAtMs: number,
  nowMs: number,
): number {
  const elapsedMinutes = Math.max(0, nowMs - observedAtMs) / 60_000;
  const estimatedMinutes = Math.max(0, reportedMinutes - elapsedMinutes);
  return (
    (Math.min(TIMELINE_MAX_MINUTES, estimatedMinutes) /
      TIMELINE_MAX_MINUTES) *
    100
  );
}

/** Converts a rail percentage to the clamped pixel position used by CSS. */
function timelineTopPixels(position: number, timelineHeight: number): number {
  const maximum = Math.max(
    TIMELINE_TOP_INSET_PX,
    timelineHeight - TIMELINE_BOTTOM_INSET_PX,
  );
  return Math.min(
    maximum,
    Math.max(TIMELINE_TOP_INSET_PX, (position / 100) * timelineHeight),
  );
}

/** Finds physical buses whose fresh ETA moved farther from the stop. */
export function backwardJumpVehicleKeys(
  previousMinutes: ReadonlyMap<string, number>,
  arrivals: readonly TimelineArrival[],
  elapsedMinutes = 0,
  minimumVisualMinutes = 0,
): Set<string> {
  return new Set(
    arrivals
      .filter((arrival) => {
        const previous = previousMinutes.get(arrival.vehicleKey);
        if (previous === undefined) return false;
        const expectedMinutes = Math.max(
          0,
          previous - elapsedMinutes,
        );
        const visualDistanceMinutes =
          Math.min(TIMELINE_MAX_MINUTES, arrival.minutes) -
          Math.min(TIMELINE_MAX_MINUTES, expectedMinutes);
        return (
          visualDistanceMinutes > 0.05 &&
          visualDistanceMinutes >= minimumVisualMinutes
        );
      })
      .map((arrival) => arrival.vehicleKey),
  );
}

/** Finds physical buses whose fresh ETA moved closer than the animated estimate. */
export function forwardJumpVehicleKeys(
  previousMinutes: ReadonlyMap<string, number>,
  arrivals: readonly TimelineArrival[],
  elapsedMinutes = 0,
): Set<string> {
  return new Set(
    arrivals
      .filter((arrival) => {
        const previous = previousMinutes.get(arrival.vehicleKey);
        if (previous === undefined) return false;
        const expectedMinutes = Math.max(0, previous - elapsedMinutes);
        return (
          Math.min(TIMELINE_MAX_MINUTES, expectedMinutes) -
            Math.min(TIMELINE_MAX_MINUTES, arrival.minutes) >
          0.05
        );
      })
      .map((arrival) => arrival.vehicleKey),
  );
}

/** Renders every physical bus on one ETA-scaled vertical rail. */
export function ArrivalTimeline({
  arrivals,
  isLoading,
  observedAt,
  onToggleLine,
  selectedLineIds,
}: ArrivalTimelineProps) {
  const [now, setNow] = useState(() => Date.now());
  const [timelineHeight, setTimelineHeight] = useState(0);
  const [previousSnapshot, setPreviousSnapshot] =
    useState<ArrivalSnapshot | null>(null);
  const timelineObserverRef = useRef<ResizeObserver | null>(null);
  const [settledObservedAt, setSettledObservedAt] = useState<string | null>(
    null,
  );
  const [entranceActive, setEntranceActive] = useState(true);
  const selectedLines = useMemo(
    () => new Set(selectedLineIds),
    [selectedLineIds],
  );

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    // Scope entrance animations to the line-mode reveal so corrections cannot replay them.
    const timeout = window.setTimeout(
      () => setEntranceActive(false),
      LINE_ENTRANCE_END_MS,
    );
    return () => window.clearTimeout(timeout);
  }, []);

  const setTimelineNode = useCallback((timeline: HTMLDivElement | null) => {
    timelineObserverRef.current?.disconnect();
    timelineObserverRef.current = null;
    if (!timeline) return;
    const updateHeight = () =>
      setTimelineHeight(timeline.getBoundingClientRect().height);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(timeline);
    timelineObserverRef.current = observer;
  }, []);

  const corrections = useMemo(() => {
    if (!observedAt || !previousSnapshot) {
      return { backward: new Set<string>(), forward: new Set<string>() };
    }
    const observedAtMs = new Date(observedAt).getTime();
    const snapshotElapsedMinutes =
      Math.max(0, observedAtMs - previousSnapshot.observedAtMs) / 60_000;
    const railTravelPx = Math.max(
      0,
      timelineHeight - TIMELINE_VERTICAL_INSET_PX,
    );
    const markerLengthMinutes =
      railTravelPx > 0
        ? (BUS_MARKER_SIZE_PX / railTravelPx) * TIMELINE_MAX_MINUTES
        : Number.POSITIVE_INFINITY;
    return {
      backward: backwardJumpVehicleKeys(
        previousSnapshot.minutes,
        arrivals,
        snapshotElapsedMinutes,
        markerLengthMinutes,
      ),
      forward: forwardJumpVehicleKeys(
        previousSnapshot.minutes,
        arrivals,
        snapshotElapsedMinutes,
      ),
    };
  }, [arrivals, observedAt, previousSnapshot, timelineHeight]);

  useEffect(() => {
    if (!observedAt) return;
    const timeout = window.setTimeout(() => {
      setPreviousSnapshot({
        observedAtMs: new Date(observedAt).getTime(),
        minutes: new Map(
          arrivals.map((arrival) => [arrival.vehicleKey, arrival.minutes]),
        ),
      });
      setSettledObservedAt(observedAt);
    }, CORRECTION_ANIMATION_MS);
    return () => window.clearTimeout(timeout);
  }, [arrivals, observedAt]);

  const observedAtMs = observedAt ? new Date(observedAt).getTime() : now;
  const elapsedMinutes = Math.max(0, (now - observedAtMs) / 60_000);
  const groups = useMemo(() => {
    const grouped = new Map<number, TimelineArrival[]>();
    for (const arrival of arrivals) {
      const bucket = Math.min(TIMELINE_MAX_MINUTES, arrival.minutes);
      grouped.set(bucket, [...(grouped.get(bucket) ?? []), arrival]);
    }
    return [...grouped.entries()]
      .map(([minutes, items]) => ({
        minutes,
        items: items.sort(
          (a, b) =>
            a.lineId.localeCompare(b.lineId, "en", { numeric: true }) ||
            a.vehicleKey.localeCompare(b.vehicleKey),
        ),
      }))
      .sort((a, b) => b.minutes - a.minutes);
  }, [arrivals]);

  return (
    <section
      aria-label="Bus arrivals"
      className={`arrival-timeline-section ${
        entranceActive ? "arrival-timeline-section-entering" : ""
      }`}
    >
      {isLoading && arrivals.length === 0 ? (
        <p className="empty-copy mt-5">Loading live arrivals...</p>
      ) : arrivals.length === 0 ? (
        <p className="arrival-timeline-empty">no bus found :(</p>
      ) : (
        <div className="arrival-timeline" ref={setTimelineNode}>
          <div aria-hidden="true" className="arrival-timeline-rail" />

          {groups.map((group) => {
            const atCutoff = group.minutes >= TIMELINE_MAX_MINUTES;
            const position = atCutoff
              ? 100
              : timelinePositionPercent(
                  group.minutes,
                  observedAtMs,
                  now,
                );
            const style = {
              "--timeline-position": `${position}%`,
            } as CSSProperties;
            const orderedItems = [...group.items].sort(
              (a, b) =>
                a.minutes - b.minutes ||
                Number(selectedLines.has(b.lineId)) -
                  Number(selectedLines.has(a.lineId)) ||
                a.lineId.localeCompare(b.lineId, "en", { numeric: true }) ||
                a.vehicleKey.localeCompare(b.vehicleKey),
            );
            const correctionActive = observedAt !== settledObservedAt;
            const movingBackward =
              !atCutoff &&
              correctionActive &&
              group.items.some((arrival) =>
                corrections.backward.has(arrival.vehicleKey),
              );
            const movingForward =
              !atCutoff &&
              correctionActive &&
              !movingBackward &&
              group.items.some((arrival) =>
                corrections.forward.has(arrival.vehicleKey),
              );
            const backwardArrival = movingBackward
              ? group.items.find((arrival) =>
                  corrections.backward.has(arrival.vehicleKey),
                )
              : undefined;
            const previousMinutes = backwardArrival
              ? previousSnapshot?.minutes.get(backwardArrival.vehicleKey)
              : undefined;
            const previousPosition =
              previousMinutes !== undefined && previousSnapshot && observedAt
                ? timelinePositionPercent(
                    previousMinutes,
                    previousSnapshot.observedAtMs,
                    observedAtMs,
                  )
                : position;
            const correctedPosition = observedAt
              ? timelinePositionPercent(
                  group.minutes,
                  observedAtMs,
                  observedAtMs,
                )
              : position;
            const backwardOffset =
              timelineTopPixels(previousPosition, timelineHeight) -
              timelineTopPixels(correctedPosition, timelineHeight);

            const groupStyle = {
              ...style,
              "--backtrack-offset": `${backwardOffset}px`,
            } as CSSProperties;

            return (
              <div
                className={`arrival-timeline-group ${
                  movingBackward
                    ? "arrival-timeline-group-backward"
                    : movingForward
                      ? "arrival-timeline-group-forward"
                      : ""
                } ${
                  position >= 100 ? "arrival-timeline-group-static" : ""
                }`}
                key={group.items
                  .map((item) => item.vehicleKey)
                  .join("-")}
                style={groupStyle}
              >
                {orderedItems.map((arrival) => {
                  const selected = selectedLines.has(arrival.lineId);
                  const muted = selectedLines.size > 0 && !selected;
                  const flippedBack =
                    !atCutoff &&
                    correctionActive &&
                    corrections.backward.has(arrival.vehicleKey);
                  const estimatedEta = Math.max(
                    0,
                    Math.ceil(arrival.minutes - elapsedMinutes),
                  );
                  const lineName = formatTransitName(arrival.lineId);
                  const entranceTiming = arrivalEntranceTiming(
                    arrival.vehicleKey,
                  );
                  // Pass each stable schedule to CSS without changing row geometry.
                  const rowStyle = {
                    "--arrival-enter-delay": `${entranceTiming.delayMs}ms`,
                    "--arrival-icon-duration": `${entranceTiming.iconDurationMs}ms`,
                    "--arrival-pop-scale": entranceTiming.overshootScale,
                    "--arrival-tag-duration": `${entranceTiming.tagDurationMs}ms`,
                  } as CSSProperties;
                  // Keep the tag mounted so only the marker flips on correction.
                  return (
                    <div
                      className={`arrival-timeline-row ${
                        flippedBack ? "arrival-timeline-row-flip" : ""
                      }`}
                      key={arrival.vehicleKey}
                      style={rowStyle}
                    >
                      <button
                        aria-label={`${
                          selected ? "Disable" : "Enable"
                        } tracking for line ${lineName}, ${estimatedEta} minutes away`}
                        aria-pressed={selected}
                        className={`arrival-timeline-bus-marker ${
                          selected
                            ? "arrival-timeline-bus-marker-selected"
                            : ""
                        }`}
                        onClick={() => onToggleLine(arrival.lineId)}
                        title={`${selected ? "Disable" : "Enable"} line ${lineName}`}
                        type="button"
                      >
                        <span
                          aria-hidden="true"
                          className="arrival-timeline-marker-flipper"
                        >
                          <span className="arrival-timeline-marker-face arrival-timeline-marker-face-disabled">
                            <BusIcon />
                          </span>
                          <span className="arrival-timeline-marker-face arrival-timeline-marker-face-enabled">
                            <BusIcon />
                          </span>
                        </span>
                      </button>
                      <button
                        aria-label={`${
                          selected ? "Disable" : "Enable"
                        } notifications for line ${lineName}, ${estimatedEta} minutes away`}
                        aria-pressed={selected}
                        className={`arrival-bus ${
                          selected ? "arrival-bus-selected" : ""
                        } ${muted ? "arrival-bus-muted" : ""}`}
                        onClick={() => onToggleLine(arrival.lineId)}
                        title={formatTransitName(arrival.description)}
                        type="button"
                      >
                        <span className="arrival-bus-code">{lineName}</span>
                        <span className="arrival-bus-eta">
                          {estimatedEta === 0 ? "NOW" : `${estimatedEta}m`}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })}

        </div>
      )}
    </section>
  );
}
