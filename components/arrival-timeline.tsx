"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { formatTransitName } from "@/lib/display";
import { Icon } from "@/components/icon";
import type { VehicleConfidence } from "@/lib/vehicle-confidence";

export interface TimelineArrival {
  routeCode: string;
  vehicleId: string;
  vehicleKey: string;
  lineId: string;
  description: string;
  destination?: string;
  minutes: number;
  confidence?: VehicleConfidence;
}

interface ArrivalTimelineProps {
  arrivals: readonly TimelineArrival[];
  isLoading: boolean;
  isUnavailable?: boolean;
  observedAt: string | null;
  onToggleRoute: (routeCode: string, lineId: string) => void;
  selectedRouteCodes: readonly string[];
}

interface ArrivalSnapshot {
  observedAtMs: number;
  minutes: ReadonlyMap<string, number>;
}

const TIMELINE_MAX_MINUTES = 20;
const MAX_VISIBLE_BUSES = 10;
const BUS_MARKER_SIZE_PX = 32;
const TIMELINE_VERTICAL_INSET_PX = 92;
const TIMELINE_TOP_INSET_PX = 20;
const TIMELINE_BOTTOM_INSET_PX = 72;
const TIMELINE_EDGE_PADDING_PX = 16;
const CORRECTION_ANIMATION_MS = 1_050;
const LINE_ENTRANCE_START_MS = 280;
const LINE_ENTRANCE_END_MS = 860;
const TAG_SLIDE_MAX_MS = 300;
/** The tag tucks away (240ms) while the circle starts its 320ms pop at 180ms. */
const DEPARTURE_MS = 500;
/** The slowest pop (360ms) peaks at 180ms, then the slowest tag slides for 300ms. */
const ARRIVAL_MS = 480;

export interface ArrivalEntranceTiming {
  delayMs: number;
  iconDurationMs: number;
  overshootScale: number;
  tagDelayMs: number;
  tagDurationMs: number;
}

/** A bus's last on-screen state, kept long enough to animate it away. */
interface RowSnapshot {
  arrival: TimelineArrival;
  top: number;
  selected: boolean;
  muted: boolean;
  estimatedEta: number;
}

function BusIcon() {
  return <Icon name="bus" className="arrival-timeline-bus-icon" />;
}

function SuccessCheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="arrival-due-check"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.5"
      viewBox="0 0 20 20"
    >
      <path d="m4 10 4 4 8-9" />
    </svg>
  );
}

function SleepIndicator() {
  return (
    <span
      aria-hidden="true"
      className="arrival-confidence-sleep"
    >
      zZz
    </span>
  );
}

function DirectionArrow() {
  return (
    <svg
      aria-hidden="true"
      className="arrival-direction-arrow"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.35"
      viewBox="0 0 14 10"
    >
      <path d="M3 5h8M8 2l3 3-3 3" />
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
    // The tag slides out once its circle has reached the top of its pop.
    tagDelayMs: delayMs + Math.round(iconDurationMs / 2),
    tagDurationMs: TAG_SLIDE_MAX_MS - 80 + (hash(4) % 81),
  };
}

function ArrivalRow({
  arrival,
  estimatedEta,
  flippedBack = false,
  isUnavailable,
  motion,
  muted,
  onToggleRoute,
  selected,
}: Omit<RowSnapshot, "top"> & {
  flippedBack?: boolean;
  isUnavailable: boolean;
  motion?: "arriving" | "departing";
  onToggleRoute: (routeCode: string, lineId: string) => void;
}) {
  const timingLabel = isUnavailable
    ? `last reported ${arrival.minutes} minutes away`
    : estimatedEta === 0
      ? "due now"
      : `${estimatedEta} minutes away`;
  const lineName = formatTransitName(arrival.lineId);
  const uncertain =
    isUnavailable || arrival.confidence === "stale" ||
    arrival.confidence === "unconfirmed";
  const slipping = !uncertain && arrival.confidence === "slipping";
  const timing = arrivalEntranceTiming(arrival.vehicleKey);
  // A bus that shows up mid-session pops in straight away, not on the reveal stagger.
  const delayShiftMs = motion === "arriving" ? timing.delayMs : 0;
  // Pass each stable schedule to CSS without changing row geometry.
  const rowStyle = {
    "--arrival-enter-delay": `${timing.delayMs - delayShiftMs}ms`,
    "--arrival-icon-duration": `${timing.iconDurationMs}ms`,
    "--arrival-pop-scale": timing.overshootScale,
    "--arrival-tag-delay": `${timing.tagDelayMs - delayShiftMs}ms`,
    "--arrival-tag-duration": `${timing.tagDurationMs}ms`,
  } as CSSProperties;

  // Keep the tag mounted so only the marker flips on correction.
  return (
    <div
      className={`arrival-timeline-row ${
        flippedBack ? "arrival-timeline-row-flip" : ""
      } ${motion ? `arrival-timeline-row-${motion}` : ""}`}
      style={rowStyle}
    >
      {(uncertain || slipping) && (
        // Outside the marker so it slides from under the circle instead of popping with it.
        <span aria-hidden="true" className="arrival-confidence-indicator">
          {uncertain ? (
            <span className="arrival-confidence-questions">??</span>
          ) : (
            <SleepIndicator />
          )}
        </span>
      )}
      <button
        aria-label={`${
          selected ? "Disable" : "Enable"
        } tracking for line ${lineName}, ${timingLabel}${
          uncertain
            ? ", arrival is unconfirmed"
            : slipping
              ? ", ETA has slipped significantly"
              : ""
        }`}
        aria-pressed={selected}
        className={`arrival-timeline-bus-marker ${
          selected
            ? "arrival-timeline-bus-marker-selected"
            : ""
        }`}
        onClick={() =>
          onToggleRoute(arrival.routeCode, arrival.lineId)
        }
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
      <span className="arrival-tag">
        <span
          className={`arrival-bus-eta ${
            !isUnavailable && estimatedEta === 0 ? "arrival-bus-eta-due" : ""
          }`}
          aria-hidden="true"
        >
          {!isUnavailable && estimatedEta === 0 ? (
            <SuccessCheckIcon />
          ) : (
            `${estimatedEta}m`
          )}
        </span>
        <button
          aria-label={`${
            selected ? "Disable" : "Enable"
          } notifications for line ${lineName}, ${timingLabel}`}
          aria-pressed={selected}
          className={`arrival-bus ${
            selected ? "arrival-bus-selected" : ""
          } ${muted ? "arrival-bus-muted" : ""}`}
          onClick={() =>
            onToggleRoute(arrival.routeCode, arrival.lineId)
          }
          title={formatTransitName(arrival.description)}
          type="button"
        >
          <span className="arrival-bus-code">{lineName}</span>
          <DirectionArrow />
          <span className="arrival-bus-direction">
            {formatTransitName(
              arrival.destination ?? arrival.description,
            )}
          </span>
        </button>
      </span>
    </div>
  );
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

/** Renders the ten soonest physical buses on one ETA-scaled vertical rail. */
export function ArrivalTimeline({
  arrivals,
  isLoading,
  isUnavailable = false,
  observedAt,
  onToggleRoute,
  selectedRouteCodes,
}: ArrivalTimelineProps) {
  const [now, setNow] = useState(() => Date.now());
  const [timelineMetrics, setTimelineMetrics] = useState({
    height: 0,
    rowHeight: 36,
    gap: 4,
  });
  const timelineHeight = timelineMetrics.height;
  const [previousSnapshot, setPreviousSnapshot] =
    useState<ArrivalSnapshot | null>(null);
  const timelineObserverRef = useRef<ResizeObserver | null>(null);
  const [settledObservedAt, setSettledObservedAt] = useState<string | null>(
    null,
  );
  const [entranceActive, setEntranceActive] = useState(true);
  const [departingRows, setDepartingRows] = useState<RowSnapshot[]>([]);
  const [arrivingKeys, setArrivingKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const previousKeysRef = useRef<ReadonlySet<string> | null>(null);
  const rowLayoutRef = useRef<ReadonlyMap<string, RowSnapshot>>(new Map());
  const motionTimersRef = useRef(new Set<number>());
  const selectedRoutes = useMemo(
    () => new Set(selectedRouteCodes),
    [selectedRouteCodes],
  );
  const visibleArrivals = useMemo(
    () => [...arrivals]
      .sort((a, b) => a.minutes - b.minutes || a.vehicleKey.localeCompare(b.vehicleKey))
      .slice(0, MAX_VISIBLE_BUSES),
    [arrivals],
  );

  useEffect(() => {
    if (isUnavailable) return;
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [isUnavailable]);

  useEffect(() => {
    // Scope entrance animations to the line-mode reveal so corrections cannot replay them.
    const timeout = window.setTimeout(
      () => setEntranceActive(false),
      LINE_ENTRANCE_END_MS + TAG_SLIDE_MAX_MS,
    );
    const motionTimers = motionTimersRef.current;
    return () => {
      window.clearTimeout(timeout);
      motionTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  const setTimelineNode = useCallback((timeline: HTMLDivElement | null) => {
    timelineObserverRef.current?.disconnect();
    timelineObserverRef.current = null;
    if (!timeline) return;
    const updateHeight = () => {
      const row = timeline.querySelector<HTMLElement>(".arrival-timeline-row");
      const group = timeline.querySelector<HTMLElement>(".arrival-timeline-group");
      setTimelineMetrics({
        height: timeline.clientHeight,
        rowHeight: row?.offsetHeight ?? 36,
        gap: group ? Number.parseFloat(getComputedStyle(group).rowGap) : 4,
      });
    };
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
  const elapsedMinutes = isUnavailable ? 0 : Math.max(0, (now - observedAtMs) / 60_000);
  const groups = useMemo(() => {
    const grouped = new Map<number, TimelineArrival[]>();
    for (const arrival of visibleArrivals) {
      const bucket = Math.min(TIMELINE_MAX_MINUTES, arrival.minutes);
      grouped.set(bucket, [...(grouped.get(bucket) ?? []), arrival]);
    }
    return [...grouped.entries()]
      .map(([minutes, items]) => {
        items.sort(
          (a, b) =>
            a.lineId.localeCompare(b.lineId, "en", { numeric: true }) ||
            a.vehicleKey.localeCompare(b.vehicleKey),
        );
        return {
          minutes,
          items,
          orderedItems: [...items].sort(
            (a, b) =>
              a.minutes - b.minutes ||
              Number(selectedRoutes.has(b.routeCode)) - Number(selectedRoutes.has(a.routeCode)) ||
              a.lineId.localeCompare(b.lineId, "en", { numeric: true }) ||
              a.vehicleKey.localeCompare(b.vehicleKey),
          ),
        };
      })
      .sort((a, b) => b.minutes - a.minutes);
  }, [visibleArrivals, selectedRoutes]);
  const groupHeights = groups.map(
    (group) =>
      group.items.length * (timelineMetrics.rowHeight + timelineMetrics.gap) -
      timelineMetrics.gap,
  );
  const minimumHeight = groupHeights.reduce(
    (height, groupHeight) => height + groupHeight + timelineMetrics.gap,
    TIMELINE_EDGE_PADDING_PX * 2 - timelineMetrics.gap,
  );
  const layoutHeight = Math.max(timelineHeight, minimumHeight);
  const groupTops = new Array<number>(groups.length);
  let nextTop = layoutHeight - TIMELINE_EDGE_PADDING_PX;
  // Pack from the far end toward the stop so shorter ETAs always sit above longer ones.
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    const position =
      group.minutes >= TIMELINE_MAX_MINUTES
        ? 100
        : timelinePositionPercent(
            group.minutes,
            observedAtMs,
            isUnavailable ? observedAtMs : now,
          );
    const desiredTop = group.minutes >= TIMELINE_MAX_MINUTES
      ? layoutHeight - TIMELINE_EDGE_PADDING_PX - groupHeights[index]
      : timelineTopPixels(position, layoutHeight) - groupHeights[index] / 2;
    groupTops[index] = Math.min(desiredTop, nextTop - groupHeights[index]);
    nextTop = groupTops[index] - timelineMetrics.gap;
  }
  // Keep a cluster near the stop inside the rail, pushing only its close neighbors down.
  let previousBottom = TIMELINE_EDGE_PADDING_PX;
  for (let index = groups.length - 1; index >= 0; index--) {
    groupTops[index] = Math.max(groupTops[index], previousBottom);
    previousBottom = groupTops[index] + groupHeights[index] + timelineMetrics.gap;
  }
  const rowLayout = new Map<string, RowSnapshot>();
  groups.forEach((group, groupIndex) => {
    group.orderedItems.forEach((arrival, rowIndex) => {
      const selected = selectedRoutes.has(arrival.routeCode);
      rowLayout.set(arrival.vehicleKey, {
        arrival,
        top:
          groupTops[groupIndex] +
          rowIndex * (timelineMetrics.rowHeight + timelineMetrics.gap),
        selected,
        muted: selectedRoutes.size > 0 && !selected,
        estimatedEta: Math.max(0, Math.ceil(arrival.minutes - elapsedMinutes)),
      });
    });
  });

  // Diff before paint against the previous render's buses, so a departing bus
  // is redrawn where it last stood and an arriving one never shows unanimated.
  useLayoutEffect(() => {
    const keys = new Set(visibleArrivals.map((arrival) => arrival.vehicleKey));
    const previousKeys = previousKeysRef.current;
    previousKeysRef.current = keys;
    if (!previousKeys || isUnavailable || isLoading) return;

    const later = (callback: () => void, delayMs: number) => {
      const timer = window.setTimeout(() => {
        motionTimersRef.current.delete(timer);
        callback();
      }, delayMs);
      motionTimersRef.current.add(timer);
    };
    const departed = [...previousKeys].flatMap((key) => {
      const row = keys.has(key) ? undefined : rowLayoutRef.current.get(key);
      return row ? [row] : [];
    });
    const arrived = entranceActive
      ? []
      : [...keys].filter((key) => !previousKeys.has(key));

    setDepartingRows((rows) => {
      // A bus that reappears mid-exit takes its place back from its copy.
      const kept = rows.filter((row) => !keys.has(row.arrival.vehicleKey));
      return kept.length === rows.length && departed.length === 0
        ? rows
        : [...kept, ...departed];
    });
    if (departed.length > 0) {
      later(
        () => setDepartingRows((rows) => rows.filter((row) => !departed.includes(row))),
        DEPARTURE_MS,
      );
    }
    if (arrived.length > 0) {
      setArrivingKeys((current) => new Set([...current, ...arrived]));
      later(
        () => setArrivingKeys((current) =>
          new Set([...current].filter((key) => !arrived.includes(key)))),
        ARRIVAL_MS,
      );
    }
  }, [entranceActive, isLoading, isUnavailable, visibleArrivals]);

  useLayoutEffect(() => {
    rowLayoutRef.current = rowLayout;
  });

  return (
    <section
      aria-label="Bus arrivals"
      className={`arrival-timeline-section ${
        entranceActive ? "arrival-timeline-section-entering" : ""
      } ${isUnavailable ? "arrival-timeline-section-unavailable" : ""}`}
    >
      {isUnavailable && <div aria-hidden="true" className="arrival-timeline-rail-broken" />}
      {isUnavailable && arrivals.length > 0 && (
        <p className="arrival-last-known text-xs font-semibold text-ink/70">Last known arrivals</p>
      )}
      {isUnavailable && arrivals.length === 0 ? (
        <p className="arrival-timeline-empty">Couldn&apos;t load live arrivals.</p>
      ) : isLoading && arrivals.length === 0 ? (
        <p className="empty-copy mt-5">Loading live arrivals...</p>
      ) : arrivals.length === 0 && departingRows.length === 0 ? (
        <p className="arrival-timeline-empty">no bus found :(</p>
      ) : (
        <div
          className="arrival-timeline"
          ref={setTimelineNode}
          style={{ minHeight: minimumHeight }}
        >
          <div aria-hidden="true" className="arrival-timeline-rail" />

          {groups.map((group, groupIndex) => {
            const atCutoff = group.minutes >= TIMELINE_MAX_MINUTES;
            const position = atCutoff
              ? 100
              : timelinePositionPercent(
                  group.minutes,
                  observedAtMs,
                  isUnavailable ? observedAtMs : now,
                );
            const style = {
              "--timeline-position": `${position}%`,
            } as CSSProperties;
            const correctionActive = !isUnavailable && observedAt !== settledObservedAt;
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
              top: `${groupTops[groupIndex]}px`,
              "--arrival-group-translate-y": "0px",
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
                {group.orderedItems.map((arrival) => (
                  <ArrivalRow
                    {...rowLayout.get(arrival.vehicleKey)!}
                    flippedBack={
                      !isUnavailable && !atCutoff &&
                      correctionActive &&
                      corrections.backward.has(arrival.vehicleKey)
                    }
                    isUnavailable={isUnavailable}
                    key={arrival.vehicleKey}
                    motion={arrivingKeys.has(arrival.vehicleKey) ? "arriving" : undefined}
                    onToggleRoute={onToggleRoute}
                  />
                ))}
              </div>
            );
          })}

          {departingRows.map(({ top, ...row }) => (
            <div
              className="arrival-timeline-group arrival-timeline-group-departing"
              inert
              key={row.arrival.vehicleKey}
              style={{ top, "--arrival-group-translate-y": "0px" } as CSSProperties}
            >
              <ArrivalRow
                {...row}
                isUnavailable={false}
                motion="departing"
                onToggleRoute={onToggleRoute}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
