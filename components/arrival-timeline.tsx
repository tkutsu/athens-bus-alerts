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
import { BusFace } from "@/components/bus-face";
import { railBadgeClass } from "@/components/rail-badges";
import type { RailConnection } from "@/hooks/use-rail-connections";
import { formatTransitName } from "@/lib/display";
import type { VehicleConfidence } from "@/lib/vehicle-confidence";
import { reachMinutes } from "@/lib/walking";

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
  railConnections?: ReadonlyMap<string, RailConnection>;
  isLoading: boolean;
  isUnavailable?: boolean;
  observedAt: string | null;
  onToggleRoute: (routeCode: string, lineId: string) => void;
  /** Takes over your bus's circle, once its tag has merged in, to pull it into the stop. */
  onTargetHome?: (bus: HTMLElement) => void;
  selectedRouteCodes: readonly string[];
  /** Your walk to the stop; undefined without a usable location. */
  walkSeconds?: number;
}

/** A bus's continuous ETA: `minutes` at `atMs`, counting down at `rate` per minute. */
export interface EtaAnchor {
  minutes: number;
  atMs: number;
  rate: number;
}

export interface EtaUpdate {
  anchors: Map<string, EtaAnchor>;
  /** Buses a fresh report moved clearly closer. */
  forward: Set<string>;
  /** Buses a fresh report moved clearly back, with the ETA shown before it. */
  backward: Map<string, number>;
}

const TIMELINE_MAX_MINUTES = 20;
const MAX_VISIBLE_BUSES = 10;
const TIMELINE_TOP_INSET_PX = 20;
const TIMELINE_BOTTOM_INSET_PX = 72;
const TIMELINE_EDGE_PADDING_PX = 16;
const CORRECTION_ANIMATION_MS = 1_050;
/** A report this much sooner than shown jumps the bus forward. */
const AHEAD_JUMP_MINUTES = 0.5;
/** A bus may run this far ahead of its report at full speed. */
const DRIFT_MINUTES = 0.5;
/** From this lead, a report further away than shown jumps the bus back. Repeats
    alone never get there: a bus slows toward a stop as it nears this lead. */
const BACKTRACK_MINUTES = 2;
const LINE_ENTRANCE_START_MS = 280;
const LINE_ENTRANCE_END_MS = 860;
const TAG_SLIDE_MAX_MS = 300;
/** The tag tucks away (240ms) while the circle starts its 320ms pop at 180ms. */
const DEPARTURE_MS = 500;
/** The tag and indicator merge into the circle before it leaves for the stop. */
const HOME_MERGE_MS = 240;
/** The slowest pop (360ms) peaks at 180ms, then the slowest tag slides for 300ms. */
const ARRIVAL_MS = 480;
/** How long the target marker takes to hop from a missed bus to the next one. */
const TARGET_HOP_MS = 600;
/** How long "Next one" floats above the new target after the hop lands. */
const CALLOUT_MS = 1_100;
/** A "??" or "zZz" within this distance of the walker tucks under its circle. */
const WALKER_CLEARANCE_PX = 30;

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
  /** The soonest watched bus you can still make. */
  target: boolean;
  /** Too close to the stop for you to walk there in time. */
  unreachable: boolean;
  /** Its confidence indicator hides, out of reach or out of the walker's way. */
  tucked: boolean;
}

interface TargetHop {
  toKey: string;
  from: number;
  to: number;
}

/**
 * Minutes, with only the changed digits dropping in: each digit is keyed by its
 * place and value, so an unchanged one keeps its element and never replays.
 */
function EtaDigits({ previous, value }: { previous: number; value: number }) {
  const digits = String(value);
  const before = String(previous);
  return (
    <>
      {[...digits].map((digit, index) => {
        const place = digits.length - 1 - index;
        const changed = digit !== before[before.length - 1 - place];
        return (
          <span
            className={`arrival-bus-eta-digit ${changed ? "arrival-bus-eta-drop" : ""}`}
            key={`${place}:${digit}`}
          >
            {digit}
          </span>
        );
      })}
      <span className="arrival-bus-eta-unit">min</span>
    </>
  );
}

function WalkerIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.2"
      viewBox="0 0 24 24"
    >
      <circle cx="13.5" cy="4" fill="currentColor" r="2" stroke="none" />
      <path d="M12.5 8 10.5 14l-3 6M10.5 14l3.5 2.5.5 4M12 8.5 8.5 11M12.5 8.5l2.5 3" />
    </svg>
  );
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

/** A stable per-bus number, so each bus keeps its own rhythm across renders. */
function vehicleHash(vehicleKey: string, salt: number): number {
  let value = 2_166_136_261 ^ salt;
  for (const character of vehicleKey) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16_777_619);
  }
  return value >>> 0;
}

/** Produces stable staggered timing without allowing entrances past the line draw. */
export function arrivalEntranceTiming(
  vehicleKey: string,
): ArrivalEntranceTiming {
  const hash = (salt: number) => vehicleHash(vehicleKey, salt);
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

const FLIP_MS = 720;
/** Where the circle is edge-on and the faces swap. */
const FLIP_TURN = 0.4;
/** How much faster flips run once you tap again mid-flip. */
const FLIP_HURRY = 2.5;
const flipQueues = new WeakMap<Element, Promise<unknown>>();

/**
 * Turns a circle over to the face its new state shows. A tap mid-flip hurries
 * the current flip to its end and queues the next one, also hurried, so every
 * flip plays out whole.
 */
function flipMarker(flipper: HTMLElement, selected: boolean) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const running = [flipper, ...flipper.children]
    .flatMap((element) => element.getAnimations())
    .filter(({ id }) => id === "flip");
  const turnOver = () =>
    turnMarker(flipper, selected, running.length > 0 ? FLIP_MS / FLIP_HURRY : FLIP_MS);
  if (running.length === 0) {
    flipQueues.set(flipper, turnOver());
    return;
  }
  for (const animation of running) animation.updatePlaybackRate(FLIP_HURRY);
  const queue = flipQueues.get(flipper) ?? Promise.resolve();
  flipQueues.set(flipper, queue.then(turnOver, turnOver));
}

/**
 * Squeezes the circle to nothing, swaps faces and opens it again. A one-off
 * animation, so once it ends nothing is left transformed and the faces render
 * sharp.
 */
function turnMarker(flipper: HTMLElement, selected: boolean, duration: number) {
  const flip = flipper.animate(
    [
      { transform: "scaleX(1)", easing: "cubic-bezier(0.5, 0, 0.9, 0.5)" },
      { transform: "scaleX(0)", offset: FLIP_TURN, easing: "cubic-bezier(0.1, 0.5, 0.3, 1)" },
      { transform: "scaleX(1)" },
    ],
    { duration, id: "flip" },
  );
  // Each face is held until the circle is edge-on, whatever CSS shows by now.
  const hold = (face: Element, from: number, to: number) =>
    face.animate(
      [
        { opacity: from, easing: "steps(1, end)" },
        { opacity: to, offset: FLIP_TURN },
        { opacity: to },
      ],
      { duration, id: "flip" },
    );
  const [disabledFace, enabledFace] = flipper.children;
  hold(selected ? enabledFace : disabledFace, 0, 1);
  hold(selected ? disabledFace : enabledFace, 1, 0);
  return flip.finished;
}

function ArrivalRow({
  arrival,
  callout = false,
  estimatedEta,
  flippedBack = false,
  isUnavailable,
  railConnection,
  motion,
  muted,
  onToggleRoute,
  selected,
  target,
  tucked,
  unreachable,
}: Omit<RowSnapshot, "top"> & {
  /** Briefly labels a bus the target has just hopped to. */
  callout?: boolean;
  flippedBack?: boolean;
  isUnavailable: boolean;
  railConnection?: RailConnection;
  motion?: "arriving" | "departing" | "homing";
  onToggleRoute: (routeCode: string, lineId: string) => void;
}) {
  const timingLabel = isUnavailable
    ? `last reported ${arrival.minutes} minutes away`
    : estimatedEta === 0
      ? "due now"
      : `${estimatedEta} minutes away`;
  const lineName = formatTransitName(arrival.lineId);
  const connectionLabel = railConnection
    ? `${railConnection.line}: ${railConnection.stops} ${railConnection.stops === 1 ? "stop" : "stops"}`
    : null;
  const uncertain =
    isUnavailable || arrival.confidence === "stale" ||
    arrival.confidence === "unconfirmed";
  const slipping = !uncertain && arrival.confidence === "slipping";
  const timing = arrivalEntranceTiming(arrival.vehicleKey);
  // A bus that shows up mid-session pops in straight away, not on the reveal stagger.
  const delayShiftMs = motion === "arriving" ? timing.delayMs : 0;
  // Pass each stable schedule to CSS without changing row geometry.
  const [eta, setEta] = useState({ value: estimatedEta, previous: estimatedEta });
  if (eta.value !== estimatedEta) {
    setEta({ value: estimatedEta, previous: eta.value });
  }
  const flipperRef = useRef<HTMLSpanElement>(null);
  const flippedTo = useRef(selected);
  // Before paint, so the new face never shows for a frame ahead of the flip.
  useLayoutEffect(() => {
    if (flippedTo.current === selected) return;
    flippedTo.current = selected;
    if (flipperRef.current) flipMarker(flipperRef.current, selected);
  }, [selected]);
  const hash = (salt: number) => vehicleHash(arrival.vehicleKey, salt);
  const rowStyle = {
    // Each face blinks and glances on its own beat.
    "--bus-blink-period": `${2_700 + (hash(5) % 1_800)}ms`,
    "--bus-blink-delay": `-${hash(6) % 4_500}ms`,
    "--bus-glance-delay": `-${hash(7) % 5_200}ms`,
    "--bus-glance-x": `${hash(8) % 2 ? 0.5 : -0.5}px`,
    "--arrival-enter-delay": `${timing.delayMs - delayShiftMs}ms`,
    "--arrival-icon-duration": `${timing.iconDurationMs}ms`,
    "--arrival-pop-scale": timing.overshootScale,
    "--arrival-tag-delay": `${timing.tagDelayMs - delayShiftMs}ms`,
    "--arrival-tag-duration": `${timing.tagDurationMs}ms`,
  } as CSSProperties;

  // Keep the tag mounted so only the marker flips on correction.
  return (
    <div
      className={[
        "arrival-timeline-row",
        flippedBack && "arrival-timeline-row-flip",
        motion && `arrival-timeline-row-${motion}`,
        target && "arrival-timeline-row-target",
        unreachable && "arrival-timeline-row-unreachable",
        uncertain ? "arrival-timeline-row-confused" : slipping && "arrival-timeline-row-sleepy",
      ].filter(Boolean).join(" ")}
      style={rowStyle}
    >
      {(uncertain || slipping) && (
        // Outside the marker so it slides from under the circle instead of popping with it.
        <span
          aria-hidden="true"
          className={`arrival-confidence-indicator ${
            tucked ? "arrival-confidence-tucked" : ""
          }`}
        >
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
        }${unreachable ? ", too soon to reach on foot" : ""}`}
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
        {/* Moods move the body, leaving the button's position and the flip alone. */}
        <span aria-hidden="true" className="arrival-timeline-marker-body">
          <span className="arrival-timeline-marker-flipper" ref={flipperRef}>
            <span className="arrival-timeline-marker-face arrival-timeline-marker-face-disabled">
              <BusFace />
            </span>
            <span className="arrival-timeline-marker-face arrival-timeline-marker-face-enabled">
              <BusFace />
            </span>
          </span>
        </span>
      </button>
      {callout && (
        <span aria-hidden="true" className="arrival-target-callout">
          Next one
        </span>
      )}
      <span className="arrival-tag">
        <span
          className={`arrival-bus-eta ${
            !isUnavailable && estimatedEta === 0 ? "arrival-bus-eta-due" : ""
          }`}
          aria-hidden="true"
        >
          {!isUnavailable && estimatedEta === 0 ? (
            <span className={eta.previous === 0 ? undefined : "arrival-bus-eta-drop"}>
              <SuccessCheckIcon />
            </span>
          ) : (
            <EtaDigits previous={eta.previous} value={estimatedEta} />
          )}
        </span>
        <button
          aria-label={`${
            selected ? "Disable" : "Enable"
          } notifications for line ${lineName}, ${timingLabel}${connectionLabel ? `, ${connectionLabel}` : ""}`}
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
          {railConnection && (
            <span className={railBadgeClass(railConnection.line)}>
              {connectionLabel}
            </span>
          )}
        </button>
      </span>
    </div>
  );
}

/** Places an ETA on the rail, one twentieth of it per minute. */
export function timelinePositionPercent(minutes: number): number {
  return (
    (Math.min(TIMELINE_MAX_MINUTES, Math.max(0, minutes)) /
      TIMELINE_MAX_MINUTES) *
    100
  );
}

/** A bus's ETA where it was last anchored, counting down at its anchored rate. */
export function anchorMinutes(anchor: EtaAnchor, nowMs: number): number {
  const elapsedMinutes = Math.max(0, nowMs - anchor.atMs) / 60_000;
  return Math.max(0, anchor.minutes - anchor.rate * elapsedMinutes);
}

/**
 * Folds a snapshot into each bus's running estimate. OASA reports whole
 * minutes and often repeats one for several polls, so a bus keeps rolling
 * toward the stop through a repeat, eases off the further it runs ahead of
 * the report, and only jumps for a clear correction either way.
 */
export function updateEtaAnchors(
  previous: ReadonlyMap<string, EtaAnchor>,
  arrivals: readonly Pick<TimelineArrival, "vehicleKey" | "minutes">[],
  observedAtMs: number,
): EtaUpdate {
  const anchors = new Map<string, EtaAnchor>();
  const forward = new Set<string>();
  const backward = new Map<string, number>();
  for (const { vehicleKey, minutes } of arrivals) {
    const fresh = { minutes, atMs: observedAtMs, rate: 1 };
    const old = previous.get(vehicleKey);
    if (!old) {
      anchors.set(vehicleKey, fresh);
      continue;
    }
    const shown = anchorMinutes(old, observedAtMs);
    const lag = minutes - shown;
    // Beyond the 20-minute edge a jump has nothing to animate.
    const visibleLag =
      Math.min(TIMELINE_MAX_MINUTES, minutes) -
      Math.min(TIMELINE_MAX_MINUTES, shown);
    if (lag < -AHEAD_JUMP_MINUTES) {
      anchors.set(vehicleKey, fresh);
      if (visibleLag < 0) forward.add(vehicleKey);
    } else if (lag >= BACKTRACK_MINUTES) {
      anchors.set(vehicleKey, fresh);
      if (visibleLag > 0) backward.set(vehicleKey, shown);
    } else {
      const overrun = Math.max(0, lag - DRIFT_MINUTES);
      anchors.set(vehicleKey, {
        minutes: shown,
        atMs: observedAtMs,
        rate: Math.max(0, 1 - overrun / (BACKTRACK_MINUTES - DRIFT_MINUTES)),
      });
    }
  }
  return { anchors, forward, backward };
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

/** Renders the ten soonest physical buses on one ETA-scaled vertical rail. */
export function ArrivalTimeline({
  arrivals,
  railConnections,
  isLoading,
  isUnavailable = false,
  observedAt,
  onToggleRoute,
  onTargetHome,
  selectedRouteCodes,
  walkSeconds,
}: ArrivalTimelineProps) {
  const [now, setNow] = useState(() => Date.now());
  const [timelineMetrics, setTimelineMetrics] = useState({
    height: 0,
    rowHeight: 36,
    gap: 4,
  });
  const timelineHeight = timelineMetrics.height;
  const timelineObserverRef = useRef<ResizeObserver | null>(null);
  const observedAtMs = observedAt ? new Date(observedAt).getTime() : now;
  // Fold each new snapshot into the running estimates before anything renders.
  const [estimates, setEstimates] = useState<
    EtaUpdate & { source: readonly TimelineArrival[] | null; id: number }
  >({ anchors: new Map(), forward: new Set(), backward: new Map(), source: null, id: 0 });
  if (estimates.source !== arrivals && !isUnavailable) {
    setEstimates({
      ...updateEtaAnchors(estimates.anchors, arrivals, observedAtMs),
      source: arrivals,
      id: estimates.id + 1,
    });
  }
  const [settledEstimateId, setSettledEstimateId] = useState(0);
  const [entranceActive, setEntranceActive] = useState(true);
  const [departingRows, setDepartingRows] = useState<
    Array<RowSnapshot & { homing: boolean }>
  >([]);
  const [targetHop, setTargetHop] = useState<TargetHop | null>(null);
  const [calloutKey, setCalloutKey] = useState<string | null>(null);
  const previousTargetRef = useRef<string | null>(null);
  const [arrivingKeys, setArrivingKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const previousKeysRef = useRef<ReadonlySet<string> | null>(null);
  const rowLayoutRef = useRef<ReadonlyMap<string, RowSnapshot>>(new Map());
  const motionTimersRef = useRef(new Set<number>());
  const sectionRef = useRef<HTMLElement>(null);
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
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [isUnavailable]);

  const later = useCallback((callback: () => void, delayMs: number) => {
    const timer = window.setTimeout(() => {
      motionTimersRef.current.delete(timer);
      callback();
    }, delayMs);
    motionTimersRef.current.add(timer);
  }, []);

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

  // Correction animations run once per snapshot, then the buses glide again.
  useEffect(() => {
    const timeout = window.setTimeout(
      () => setSettledEstimateId(estimates.id),
      CORRECTION_ANIMATION_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [estimates.id]);
  const correctionActive = !isUnavailable && estimates.id !== settledEstimateId;

  /** Where a bus is now; frozen at its last report while the feed is down. */
  const shownMinutes = (arrival: TimelineArrival) => {
    const anchor = estimates.anchors.get(arrival.vehicleKey);
    return isUnavailable || !anchor
      ? arrival.minutes
      : anchorMinutes(anchor, now);
  };
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
        : timelinePositionPercent(shownMinutes(group.orderedItems[0]));
    const desiredTop = group.minutes >= TIMELINE_MAX_MINUTES
      ? layoutHeight - TIMELINE_EDGE_PADDING_PX - groupHeights[index]
      : timelineTopPixels(position, layoutHeight) - groupHeights[index] / 2;
    groupTops[index] = Math.min(desiredTop, nextTop - groupHeights[index]);
    nextTop = groupTops[index] - timelineMetrics.gap;
  }
  // Keep a cluster near the stop inside the rail, pushing only its close neighbors down.
  let previousBottom = TIMELINE_EDGE_PADDING_PX;
  for (let index = groups.length - 1; index >= 0; index--) {
    // Whole pixels: a hopping bus gets its own GPU layer, and a layer placed
    // between pixels is resampled and looks soft on 1x screens.
    groupTops[index] = Math.round(Math.max(groupTops[index], previousBottom));
    previousBottom = groupTops[index] + groupHeights[index] + timelineMetrics.gap;
  }
  // You sit on the rail at your walking time; buses between you and the stop
  // are out of reach, and the soonest watched bus beyond you is your target.
  const reach = isUnavailable ? 0 : reachMinutes(walkSeconds);
  const showWalker = !isUnavailable && walkSeconds !== undefined;
  const walkerTop = reach > 0
    ? timelineTopPixels(
        (Math.min(TIMELINE_MAX_MINUTES, reach) / TIMELINE_MAX_MINUTES) * 100,
        layoutHeight,
      )
    : 0;
  const isUnreachable = (arrival: TimelineArrival) =>
    shownMinutes(arrival) < reach;
  const targetKey = isUnavailable
    ? null
    : visibleArrivals.find(
        (arrival) =>
          selectedRoutes.has(arrival.routeCode) && !isUnreachable(arrival),
      )?.vehicleKey ?? null;
  const rowLayout = new Map<string, RowSnapshot>();
  groups.forEach((group, groupIndex) => {
    group.orderedItems.forEach((arrival, rowIndex) => {
      const selected = selectedRoutes.has(arrival.routeCode);
      const top =
        groupTops[groupIndex] +
        rowIndex * (timelineMetrics.rowHeight + timelineMetrics.gap);
      const unreachable = isUnreachable(arrival);
      rowLayout.set(arrival.vehicleKey, {
        arrival,
        top,
        selected,
        muted: selectedRoutes.size > 0 && !selected,
        // Only a reported 0 earns the tick; counting down alone stops at a minute.
        estimatedEta: arrival.minutes === 0
          ? 0
          : Math.max(1, Math.ceil(shownMinutes(arrival))),
        // The target only lights up once the hop marker lands on it.
        target:
          arrival.vehicleKey === targetKey &&
          targetHop?.toKey !== arrival.vehicleKey,
        unreachable,
        tucked:
          unreachable ||
          (reach > 0 &&
            Math.abs(top + timelineMetrics.rowHeight / 2 - walkerTop) <
              WALKER_CLEARANCE_PX),
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

    const departed = [...previousKeys].flatMap((key) => {
      const row = keys.has(key) ? undefined : rowLayoutRef.current.get(key);
      // Your bus pulls into the stop when you're there to meet it.
      return row
        ? [{ ...row, homing: row.target && reach === 0 && row.estimatedEta <= 1 }]
        : [];
    });
    const homing = departed.some((row) => row.homing);
    if (homing && onTargetHome) {
      later(() => {
        const bus = sectionRef.current?.querySelector<HTMLElement>(
          ".arrival-timeline-row-homing .arrival-timeline-marker-face-enabled",
        );
        if (bus) onTargetHome(bus);
      }, HOME_MERGE_MS);
    }
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
        // A homing copy stays a moment past the handover so the circle never blinks out.
        homing ? HOME_MERGE_MS + 100 : DEPARTURE_MS,
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
  }, [
    entranceActive,
    isLoading,
    isUnavailable,
    later,
    onTargetHome,
    reach,
    visibleArrivals,
  ]);

  useLayoutEffect(() => {
    rowLayoutRef.current = rowLayout;
  });

  // When the target changes while both buses are on the rail, a marker hops
  // from the old one to the new one, so a missed bus hands over visibly.
  useLayoutEffect(() => {
    const previous = previousTargetRef.current;
    previousTargetRef.current = targetKey;
    if (!previous || !targetKey || previous === targetKey || entranceActive) {
      return;
    }
    const from = rowLayoutRef.current.get(previous);
    const to = rowLayoutRef.current.get(targetKey);
    if (!from || !to) return;
    const centre = timelineMetrics.rowHeight / 2;
    setTargetHop({ toKey: targetKey, from: from.top + centre, to: to.top + centre });
    later(() => {
      setTargetHop((hop) => (hop?.toKey === targetKey ? null : hop));
      setCalloutKey(targetKey);
    }, TARGET_HOP_MS);
    later(
      () => setCalloutKey((key) => (key === targetKey ? null : key)),
      TARGET_HOP_MS + CALLOUT_MS,
    );
  }, [entranceActive, later, targetKey, timelineMetrics.rowHeight]);

  return (
    <section
      aria-label="Bus arrivals"
      ref={sectionRef}
      className={`arrival-timeline-section ${
        entranceActive ? "arrival-timeline-section-entering" : ""
      } ${isUnavailable ? "arrival-timeline-section-unavailable" : ""}`}
    >
      {isUnavailable && <div aria-hidden="true" className="arrival-timeline-rail-broken" />}
      {isUnavailable && arrivals.length > 0 && (
        <p className="arrival-last-known text-xs font-semibold text-ink/70">Last known arrivals</p>
      )}
      {isUnavailable && arrivals.length === 0 ? (
        <p className="arrival-timeline-empty">Reconnecting…</p>
      ) : isLoading && arrivals.length === 0 ? (
        <p className="empty-copy mt-5">Loading live arrivals...</p>
      ) : arrivals.length === 0 && departingRows.length === 0 ? (
        <p className="arrival-timeline-empty arrival-timeline-quiet">
          <span aria-hidden="true" className="arrival-timeline-row-sleepy">
            <span className="arrival-timeline-marker-body arrival-quiet-face">
              <BusFace />
            </span>
          </span>
          All quiet
        </p>
      ) : (
        <div
          className="arrival-timeline"
          ref={setTimelineNode}
          style={{ minHeight: minimumHeight }}
        >
          <div aria-hidden="true" className="arrival-timeline-rail" />
          {showWalker && (
            <div
              aria-label={
                reach > 0
                  ? `You, about ${Math.round(walkSeconds / 60)} min walk from the stop`
                  : "You, at the stop"
              }
              className={`arrival-walker ${reach > 0 ? "" : "arrival-walker-home"}`}
              role="img"
              style={{ top: walkerTop }}
            >
              <span className="arrival-walker-line" />
              <span className="arrival-walker-badge">
                <WalkerIcon />
              </span>
            </div>
          )}
          {targetHop && (
            <span
              aria-hidden="true"
              className="arrival-target-hop"
              key={targetHop.toKey}
              style={{
                "--hop-from": `${targetHop.from}px`,
                "--hop-to": `${targetHop.to}px`,
              } as CSSProperties}
            />
          )}

          {groups.map((group, groupIndex) => {
            const atCutoff = group.minutes >= TIMELINE_MAX_MINUTES;
            const position = atCutoff
              ? 100
              : timelinePositionPercent(shownMinutes(group.orderedItems[0]));
            const movingBackward =
              !atCutoff &&
              correctionActive &&
              group.items.some((arrival) =>
                estimates.backward.has(arrival.vehicleKey),
              );
            const movingForward =
              !atCutoff &&
              correctionActive &&
              !movingBackward &&
              group.items.some((arrival) =>
                estimates.forward.has(arrival.vehicleKey),
              );
            const backwardArrival = movingBackward
              ? group.items.find((arrival) =>
                  estimates.backward.has(arrival.vehicleKey),
                )
              : undefined;
            const previousMinutes = backwardArrival
              ? estimates.backward.get(backwardArrival.vehicleKey)
              : undefined;
            const previousPosition =
              previousMinutes !== undefined
                ? timelinePositionPercent(previousMinutes)
                : position;
            const correctedPosition = backwardArrival
              ? timelinePositionPercent(backwardArrival.minutes)
              : position;
            const backwardOffset =
              timelineTopPixels(previousPosition, timelineHeight) -
              timelineTopPixels(correctedPosition, timelineHeight);

            const groupStyle = {
              top: `${groupTops[groupIndex]}px`,
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
                data-timeline-position={`${position}%`}
                style={groupStyle}
              >
                {group.orderedItems.map((arrival) => (
                  <ArrivalRow
                    {...rowLayout.get(arrival.vehicleKey)!}
                    callout={calloutKey === arrival.vehicleKey}
                    flippedBack={
                      !isUnavailable && !atCutoff &&
                      correctionActive &&
                      estimates.backward.has(arrival.vehicleKey)
                    }
                    isUnavailable={isUnavailable}
                    key={arrival.vehicleKey}
                    railConnection={railConnections?.get(arrival.routeCode)}
                    motion={arrivingKeys.has(arrival.vehicleKey) ? "arriving" : undefined}
                    onToggleRoute={onToggleRoute}
                  />
                ))}
              </div>
            );
          })}

          {departingRows.map(({ top, homing, ...row }) => (
            <div
              className="arrival-timeline-group arrival-timeline-group-departing"
              inert
              key={row.arrival.vehicleKey}
              style={{ top }}
            >
              <ArrivalRow
                {...row}
                isUnavailable={false}
                railConnection={railConnections?.get(row.arrival.routeCode)}
                motion={homing ? "homing" : "departing"}
                onToggleRoute={onToggleRoute}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
