"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  evaluateAlarm,
  type AlertEvent,
  type CandidateArrival,
} from "@/lib/alerts";
import { formatDistance, haversineMeters } from "@/lib/distance";
import {
  clearStoredState,
  readStoredState,
  writeStoredState,
} from "@/lib/storage";
import {
  OPTIONAL_THRESHOLDS,
  type ActiveAlarm,
  type ApiErrorPayload,
  type Arrival,
  type Coordinates,
  type Favorite,
  type OptionalThreshold,
  type ServingLine,
  type ServingRoute,
  type StopSummary,
} from "@/lib/types";
import { dedupeArrivals } from "@/lib/arrivals";
import {
  findClosestStops,
  searchStopNames,
} from "@/lib/stop-catalog";
import { useArrivalPolling } from "@/hooks/use-arrival-polling";
import { useStopCatalog } from "@/hooks/use-stop-catalog";
import { StopCombobox } from "@/components/stop-combobox";
import { StopMap } from "@/components/stop-map";

interface StopDetailsPayload {
  stop: StopSummary;
  routes: ServingRoute[];
  lines: ServingLine[];
}

type StepName = "stop" | "buses" | "notify";
const MESSAGE_DISMISS_MS = 30_000;
const LOCATION_REFRESH_MS = 60_000;
const COLLAPSED_STEPS: Record<StepName, boolean> = {
  stop: false,
  buses: false,
  notify: false,
};

function Icon({
  name,
  className = "size-5",
}: {
  name:
    | "bell"
    | "bus"
    | "locate"
    | "pencil"
    | "refresh"
    | "star";
  className?: string;
}) {
  const paths = {
    bell: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </>
    ),
    bus: (
      <>
        <path d="M8 6v6m8-6v6M6 17h12M7 21v-2m10 2v-2" />
        <rect x="4" y="3" width="16" height="16" rx="2" />
        <path d="M8 15h.01M16 15h.01" />
      </>
    ),
    locate: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
        <circle cx="12" cy="12" r="8" />
      </>
    ),
    pencil: (
      <>
        <path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10z" />
        <path d="m14 7 3 3M4 20l1-4 3.5 3" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5" />
        <path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" />
      </>
    ),
    star: <path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2l-5-4.9 6.9-1z" />,
  };

  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      suppressHydrationWarning
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {paths[name]}
    </svg>
  );
}

/** Renders a collapsible workflow heading. */
function StepTitle({
  controls,
  expanded,
  id,
  label,
  onToggle,
  selection,
}: {
  controls: string;
  expanded: boolean;
  id: string;
  label: string;
  onToggle: () => void;
  selection?: string;
}) {
  return (
    <h2 className="min-w-0 flex-1" id={id}>
      <button
        aria-controls={controls}
        aria-expanded={expanded}
        className="section-label flex max-w-full items-center gap-2 text-left"
        onClick={onToggle}
        type="button"
      >
        <span className="shrink-0">{label}</span>
        {selection && (
          <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className="shrink-0 text-ink/60">
              ·
            </span>
            <span className="truncate font-mono font-semibold tracking-normal text-ink normal-case">
              {selection}
            </span>
          </span>
        )}
        <span aria-hidden="true" className="shrink-0 text-base leading-none">
          {expanded ? "▾" : "▸"}
        </span>
      </button>
    </h2>
  );
}

/** Reads an error message returned by an app API route. */
async function responseError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as
    | ApiErrorPayload
    | null;
  return payload?.error.message ?? "The request could not be completed.";
}

/** Keeps only the stop fields saved on the device. */
function stopReference(stop: StopSummary) {
  return { code: stop.code, name: stop.name };
}

/** Sorts favorites by recent use, then name. */
function sortFavorites(favorites: readonly Favorite[]): Favorite[] {
  return [...favorites].sort(
    (a, b) =>
      (b.lastEnabledAt ?? "").localeCompare(a.lastEnabledAt ?? "") ||
      a.name.localeCompare(b.name, "en"),
  );
}

function formatThresholds(thresholds: readonly OptionalThreshold[]) {
  return [...thresholds, 0].join("/");
}

/** Joins OASA route codes to the line identifiers used by alarms. */
function buildCandidateArrivals(
  arrivals: Arrival[],
  routes: ServingRoute[],
): CandidateArrival[] {
  const routeLines = new Map(
    routes.map((route) => [route.routeCode, route.lineId]),
  );

  return arrivals.flatMap((arrival) => {
    const lineId = routeLines.get(arrival.routeCode);
    return lineId ? [{ lineId, minutes: arrival.minutes }] : [];
  });
}

export function TickerApp() {
  const [hydrated, setHydrated] = useState(false);
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [selectedStop, setSelectedStop] = useState<StopSummary | null>(null);
  const [routes, setRoutes] = useState<ServingRoute[]>([]);
  const [lines, setLines] = useState<ServingLine[]>([]);
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
  const [thresholds, setThresholds] = useState<OptionalThreshold[]>([
    ...OPTIONAL_THRESHOLDS,
  ]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [activeAlarm, setActiveAlarmState] = useState<ActiveAlarm | null>(null);
  const activeAlarmRef = useRef<ActiveAlarm | null>(null);
  const hydrationStartedRef = useRef(false);
  const favoriteNameInputRef = useRef<HTMLInputElement | null>(null);
  const coordinatesRef = useRef<Coordinates | null>(null);
  const locationDeniedRef = useRef(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [isLoadingStop, setIsLoadingStop] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [favoriteName, setFavoriteName] = useState("");
  const [expandedSteps, setExpandedSteps] = useState<
    Record<StepName, boolean>
  >({
    stop: true,
    buses: true,
    notify: true,
  });

  const {
    data: arrivalData,
    error: arrivalError,
    isLoading: arrivalsLoading,
    refresh,
    stale,
  } = useArrivalPolling(
    activeAlarm &&
      !activeAlarm.completedAt &&
      activeAlarm.stopCode === selectedStop?.code
      ? activeAlarm.stopCode
      : null,
  );
  const {
    stops: catalogStops,
    error: catalogError,
    isLoading: catalogLoading,
  } = useStopCatalog();
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const nearbyStops = useMemo(
    () =>
      coordinates
        ? findClosestStops(catalogStops, coordinates)
        : [],
    [catalogStops, coordinates],
  );
  const searchResult = useMemo(
    () =>
      coordinates
        ? searchStopNames(
            catalogStops,
            deferredSearchQuery,
            coordinates,
          )
        : { stops: [], total: 0 },
    [catalogStops, coordinates, deferredSearchQuery],
  );
  const searchResults = searchResult.stops;
  const searchTotal =
    searchQuery.trim().length >= 2 ? searchResult.total : null;
  const isSearching = searchQuery !== deferredSearchQuery;

  const updateAlarm = useCallback((alarm: ActiveAlarm | null) => {
    activeAlarmRef.current = alarm;
    setActiveAlarmState(alarm);
  }, []);

  /** Loads stop details and drops saved lines that no longer serve it. */
  const loadStop = useCallback(
    async (
      requestedStop: Pick<StopSummary, "code" | "name"> &
        Partial<StopSummary>,
      requestedLines: string[] = [],
    ): Promise<{ stop: StopSummary; validLines: string[] } | null> => {
      setIsLoadingStop(true);
      setError(null);

      if (
        activeAlarmRef.current &&
        activeAlarmRef.current.stopCode !== requestedStop.code
      ) {
        updateAlarm(null);
        setStatus("The previous alert was cancelled because the stop changed.");
      }

      try {
        const response = await fetch(`/api/stops/${requestedStop.code}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(await responseError(response));
        }

        const payload = (await response.json()) as StopDetailsPayload;
        const distanceMeters =
          coordinates && Number.isFinite(payload.stop.latitude)
            ? haversineMeters(coordinates, payload.stop)
            : (requestedStop.distanceMeters ?? 0);
        const stop = { ...payload.stop, distanceMeters };
        const validLineIds = new Set(payload.lines.map((line) => line.lineId));
        const validLines = requestedLines.filter((lineId) =>
          validLineIds.has(lineId),
        );

        setSelectedStop(stop);
        setRoutes(payload.routes);
        setLines(payload.lines);
        setSelectedLineIds(validLines);
        return { stop, validLines };
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load that stop.",
        );
        return null;
      } finally {
        setIsLoadingStop(false);
      }
    },
    [coordinates, updateAlarm],
  );

  /* eslint-disable react-hooks/set-state-in-effect -- browser storage hydrates after SSR */
  useEffect(() => {
    if (hydrationStartedRef.current) return;
    hydrationStartedRef.current = true;

    const stored = readStoredState();
    // Browser storage is not available during server rendering.
    setThresholds(stored.optionalThresholds);
    setFavorites(stored.favorites);
    updateAlarm(stored.activeAlarm);
    if (stored.activeAlarm) {
      setExpandedSteps(COLLAPSED_STEPS);
    }

    if (stored.selectedStop) {
      void loadStop(stored.selectedStop, stored.selectedLineIds).finally(() => {
        setHydrated(true);
      });
    } else {
      setHydrated(true);
    }

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js");
    }
  }, [loadStop, updateAlarm]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!hydrated) return;

    writeStoredState({
      version: 2,
      selectedStop: selectedStop ? stopReference(selectedStop) : null,
      selectedLineIds,
      optionalThresholds: thresholds,
      favorites,
      activeAlarm,
    });
  }, [
    activeAlarm,
    favorites,
    hydrated,
    selectedLineIds,
    selectedStop,
    thresholds,
  ]);

  useEffect(() => {
    if (!error && !status) return;

    // Clear transient messages after 30 seconds.
    const timeout = window.setTimeout(() => {
      setError(null);
      setStatus(null);
    }, MESSAGE_DISMISS_MS);
    return () => window.clearTimeout(timeout);
  }, [error, status]);

  useEffect(() => {
    const closeFavoriteMenus = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;

      document
        .querySelectorAll<HTMLDetailsElement>(
          "details[data-favorite-menu][open]",
        )
        .forEach((menu) => {
          if (!menu.contains(target)) menu.removeAttribute("open");
        });
    };

    document.addEventListener("pointerdown", closeFavoriteMenus);
    return () =>
      document.removeEventListener("pointerdown", closeFavoriteMenus);
  }, []);

  const routeByCode = useMemo(
    () => new Map(routes.map((route) => [route.routeCode, route])),
    [routes],
  );
  const uniqueArrivals = useMemo(
    () => dedupeArrivals(arrivalData?.arrivals ?? []),
    [arrivalData?.arrivals],
  );
  const candidates = useMemo(
    () => buildCandidateArrivals(uniqueArrivals, routes),
    [routes, uniqueArrivals],
  );

  const showAlert = useCallback(
    async (event: AlertEvent, alarm: ActiveAlarm) => {
      const line = event.lineId ?? alarm.lastObservedLineId ?? "Bus";
      const title =
        event.kind === "zero"
          ? `${line} is due now`
          : `${line} is ${event.minutes} min away`;
      const body = `${alarm.stopName} · ${
        event.kind === "warning"
          ? `${event.threshold}-minute alert`
          : "arrival alert"
      }`;

      try {
        if ("serviceWorker" in navigator) {
          const registration = await navigator.serviceWorker.ready;
          await registration.showNotification(title, {
            body,
            icon: "/icon-192.png",
            badge: "/icon-192.png",
            tag: `alarm-${alarm.id}`,
          });
        } else {
          new Notification(title, { body, tag: `alarm-${alarm.id}` });
        }
        setStatus(
          event.kind === "zero"
            ? `${line} is due. Alert finished.`
            : `${event.threshold}-minute alert sent for ${line} at ${event.minutes} min.`,
        );
      } catch {
        setStatus(`${title}. ${body}`);
      }
    },
    [],
  );

  /** Saves alarm state before notifying so polling cannot send duplicates. */
  const processAlarm = useCallback(
    async (
      alarm: ActiveAlarm,
      currentCandidates: CandidateArrival[],
      now = new Date(),
    ) => {
      const evaluation = evaluateAlarm(alarm, currentCandidates, now);
      updateAlarm(evaluation.alarm);

      if (evaluation.event) {
        await showAlert(evaluation.event, alarm);
      }
    },
    [showAlert, updateAlarm],
  );

  useEffect(() => {
    const alarm = activeAlarmRef.current;
    if (
      !alarm ||
      !arrivalData ||
      alarm.stopCode !== selectedStop?.code ||
      new Date(arrivalData.observedAt).getTime() <
        new Date(alarm.armedAt).getTime()
    ) {
      return;
    }
    void processAlarm(alarm, candidates, new Date(arrivalData.observedAt));
  }, [
    arrivalData?.observedAt,
    candidates,
    processAlarm,
    selectedStop?.code,
    arrivalData,
  ]);

  useEffect(() => {
    if (!activeAlarm?.predictedZeroAt) return;

    const delay = Math.max(
      0,
      new Date(activeAlarm.predictedZeroAt).getTime() - Date.now(),
    );
    const timeout = window.setTimeout(() => {
      const alarm = activeAlarmRef.current;
      if (alarm) {
        void processAlarm(alarm, [], new Date());
      }
    }, Math.min(delay, 2_147_000_000));

    return () => window.clearTimeout(timeout);
  }, [activeAlarm?.predictedZeroAt, processAlarm]);

  async function ensureNotificationPermission(): Promise<boolean> {
    if (!("Notification" in window)) {
      setError("This browser does not support notifications.");
      return false;
    }

    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") {
      setError("Notifications are blocked in your browser settings.");
      return false;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setError("Notification permission is required to arm an alert.");
      return false;
    }
    return true;
  }

  /** Arms one alert for the earliest selected bus. */
  async function armWith(
    stop: StopSummary,
    lineIds: string[],
    alarmThresholds: OptionalThreshold[],
  ) {
    if (!(await ensureNotificationPermission())) return;

    const alarm: ActiveAlarm = {
      id: crypto.randomUUID(),
      stopCode: stop.code,
      stopName: stop.name,
      selectedLineIds: lineIds,
      optionalThresholds: alarmThresholds,
      firedThresholds: [],
      predictedZeroAt: null,
      lastObservedLineId: null,
      lastObservedMinutes: null,
      armedAt: new Date().toISOString(),
      completedAt: null,
    };

    updateAlarm(alarm);
    setExpandedSteps(COLLAPSED_STEPS);
    setStatus(
      `Alert armed for ${lineIds.join(", ")}. Zero minutes is always included.`,
    );
  }

  /** Re-arms a completed alert with its previous stop, buses, and times. */
  async function restartAlarm(alarm: ActiveAlarm) {
    const currentLineIds = new Set(lines.map((line) => line.lineId));
    const loaded =
      selectedStop?.code === alarm.stopCode
        ? {
            stop: selectedStop,
            validLines: alarm.selectedLineIds.filter((lineId) =>
              currentLineIds.has(lineId),
            ),
          }
        : await loadStop(
            { code: alarm.stopCode, name: alarm.stopName },
            alarm.selectedLineIds,
          );

    if (!loaded || loaded.validLines.length === 0) {
      setError("The saved buses no longer serve this stop.");
      return;
    }

    setThresholds(alarm.optionalThresholds);
    setSelectedLineIds(loaded.validLines);
    await armWith(
      loaded.stop,
      loaded.validLines,
      alarm.optionalThresholds,
    );
  }

  /** Reads the device location used for client-side stop ordering. */
  const locate = useCallback(
    (force = false) => {
      if (locationDeniedRef.current && !force) return;

      const showProgress = force || coordinatesRef.current === null;
      if (showProgress) {
        setIsLocating(true);
        setError(null);
      }

      if (!navigator.geolocation) {
        setError("Location is not supported. Choose a stop on the map.");
        setIsLocating(false);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const firstLocation = coordinatesRef.current === null;
          const nextCoordinates = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          };
          locationDeniedRef.current = false;
          coordinatesRef.current = nextCoordinates;
          setCoordinates(nextCoordinates);
          if (force || firstLocation) {
            setStatus("Showing the closest stops.");
          }
          if (showProgress) setIsLocating(false);
        },
        (locationError) => {
          if (locationError.code === 1) locationDeniedRef.current = true;
          if (showProgress) {
            const messages: Record<number, string> = {
              1: "Location was denied. Choose a stop on the map.",
              2: "Your location is unavailable. Try again or use the map.",
              3: "Location timed out. Try again or use the map.",
            };
            setError(
              messages[locationError.code] ?? "Could not get your location.",
            );
            setIsLocating(false);
          }
        },
        { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
      );
    },
    [],
  );

  useEffect(() => {
    if (!hydrated) return;

    // The catalogue stays in the browser, so each location fix can reorder it
    // without making a Worker request.
    const initialLocation = window.setTimeout(locate, 0);
    const interval = window.setInterval(locate, LOCATION_REFRESH_MS);
    return () => {
      window.clearTimeout(initialLocation);
      window.clearInterval(interval);
    };
  }, [hydrated, locate]);

  /** Updates the client-side stop-name search. */
  function updateStopQuery(query: string) {
    setSearchQuery(query);
  }

  /** Selects a stop from either the map or combined picker. */
  function chooseStop(stop: StopSummary) {
    setSearchQuery("");
    void loadStop(stop);
  }

  function toggleLine(lineId: string) {
    setSelectedLineIds((current) =>
      current.includes(lineId)
        ? current.filter((candidate) => candidate !== lineId)
        : [...current, lineId],
    );
  }

  function toggleThreshold(threshold: OptionalThreshold) {
    setThresholds((current) =>
      current.includes(threshold)
        ? current.filter((candidate) => candidate !== threshold)
        : [...current, threshold].sort((a, b) => b - a),
    );
  }

  /** Collapses visual workflow sections without changing their selections. */
  function toggleStep(step: StepName) {
    setExpandedSteps((current) => ({
      ...current,
      [step]: !current[step],
    }));
  }

  /** Saves the current selection as a favorite. */
  function saveFavorite() {
    if (!selectedStop || selectedLineIds.length === 0) return;
    const name = favoriteName.trim();
    if (name.length < 1 || name.length > 40) {
      setError("Favorite names must contain 1 to 40 characters.");
      return;
    }

    const existing = favorites.find(
      (favorite) => favorite.name.toLowerCase() === name.toLowerCase(),
    );
    if (
      existing &&
      !window.confirm(`Replace the existing "${existing.name}" favorite?`)
    ) {
      return;
    }

    const now = new Date().toISOString();
    const favorite: Favorite = {
      id: existing?.id ?? crypto.randomUUID(),
      name,
      stop: stopReference(selectedStop),
      lineIds: selectedLineIds,
      optionalThresholds: thresholds,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastEnabledAt: existing?.lastEnabledAt ?? null,
    };
    setFavorites((current) => [
      ...current.filter((item) => item.id !== favorite.id),
      favorite,
    ]);
    setFavoriteName("");
    setStatus(`Saved "${name}".`);
  }

  /** Loads and arms a favorite. */
  async function enableFavorite(favorite: Favorite) {
    if (
      activeAlarmRef.current &&
      !window.confirm("Replace the currently active alert?")
    ) {
      return;
    }

    setThresholds(favorite.optionalThresholds);
    const loaded = await loadStop(favorite.stop, favorite.lineIds);
    if (!loaded) return;

    if (loaded.validLines.length === 0) {
      setError(
        `None of the saved lines for "${favorite.name}" currently serve this stop.`,
      );
      return;
    }

    if (loaded.validLines.length !== favorite.lineIds.length) {
      setStatus("Some saved lines no longer serve this stop and were removed.");
    }

    const enabledAt = new Date().toISOString();
    setFavorites((current) =>
      current.map((item) =>
        item.id === favorite.id
          ? { ...item, lastEnabledAt: enabledAt }
          : item,
      ),
    );
    await armWith(
      loaded.stop,
      loaded.validLines,
      favorite.optionalThresholds,
    );
  }

  function renameFavorite(favorite: Favorite) {
    const value = window.prompt("Favorite name", favorite.name)?.trim();
    if (!value || value === favorite.name) return;
    if (value.length > 40) {
      setError("Favorite names can be at most 40 characters.");
      return;
    }
    if (
      favorites.some(
        (item) =>
          item.id !== favorite.id &&
          item.name.toLowerCase() === value.toLowerCase(),
      )
    ) {
      setError("Another favorite already uses that name.");
      return;
    }
    setFavorites((current) =>
      current.map((item) =>
        item.id === favorite.id
          ? { ...item, name: value, updatedAt: new Date().toISOString() }
          : item,
      ),
    );
  }

  function updateFavorite(favorite: Favorite) {
    if (!selectedStop || selectedLineIds.length === 0) {
      setError("Choose a stop and at least one line first.");
      return;
    }
    setFavorites((current) =>
      current.map((item) =>
        item.id === favorite.id
          ? {
              ...item,
              stop: stopReference(selectedStop),
              lineIds: selectedLineIds,
              optionalThresholds: thresholds,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    );
    setStatus(`Updated "${favorite.name}".`);
  }

  function deleteFavorite(favorite: Favorite) {
    if (!window.confirm(`Delete "${favorite.name}"?`)) return;
    setFavorites((current) =>
      current.filter((item) => item.id !== favorite.id),
    );
  }

  function closeFavoriteMenu(button: HTMLButtonElement) {
    button.closest("details")?.removeAttribute("open");
  }

  function forgetEverything() {
    if (!window.confirm("Forget the saved stop, favorites, and active alert?")) {
      return;
    }
    clearStoredState();
    setSelectedStop(null);
    setRoutes([]);
    setLines([]);
    setSelectedLineIds([]);
    setThresholds([...OPTIONAL_THRESHOLDS]);
    setFavorites([]);
    updateAlarm(null);
    setStatus("Saved data cleared.");
  }

  const displayArrivals = uniqueArrivals.map((arrival) => ({
    ...arrival,
    route: routeByCode.get(arrival.routeCode),
  }));
  const canSaveFavorite =
    selectedStop !== null && selectedLineIds.length > 0;

  /** Renders arrivals in the normal or active-alert layout. */
  function renderLiveArrivals(
    className: string,
    edgeToEdge = false,
  ) {
    return (
      <section aria-labelledby="arrivals-heading" className={className}>
        <div className="mb-3 flex items-center justify-between">
          <h2 id="arrivals-heading" className="section-label">
            Live arrivals
          </h2>
          <button
            className="small-action flex items-center gap-1.5"
            disabled={arrivalsLoading}
            onClick={() => void refresh()}
            type="button"
          >
            <Icon
              name="refresh"
              className={
                arrivalsLoading ? "size-4 animate-spin" : "size-4"
              }
            />
            Refresh
          </button>
        </div>

        {arrivalsLoading && !arrivalData ? (
          <div
            className={
              edgeToEdge
                ? "ticker-skeleton ticker-skeleton-active"
                : "ticker-skeleton"
            }
          />
        ) : displayArrivals.length === 0 ? (
          <p
            className={
              edgeToEdge
                ? "border-y border-dashed border-signal/25 py-5 text-sm text-ink/45"
                : "empty-copy"
            }
          >
            No live arrivals right now.
          </p>
        ) : (
          <div
            className={`border-y ${
              edgeToEdge
                ? "-mx-3 border-signal/25"
                : "border-ink/20"
            }`}
          >
            {displayArrivals.map((arrival) => {
              const selected =
                arrival.route &&
                selectedLineIds.includes(arrival.route.lineId);
              return (
                <div
                  className={`grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 border-b py-3 last:border-0 ${
                    selected ? "bg-signal/6" : ""
                  } ${
                    edgeToEdge
                      ? "border-signal/15 px-3"
                      : "border-ink/10"
                  }`}
                  key={`${arrival.routeCode}-${arrival.vehicleId}`}
                >
                  <span
                    className={
                      selected ? "arrival-line-selected" : "arrival-line"
                    }
                  >
                    {arrival.route?.lineId ?? "-"}
                  </span>
                  <span className="min-w-0 truncate text-sm text-ink/65">
                    {arrival.route?.description ??
                      `Route ${arrival.routeCode}`}
                  </span>
                  <span className="font-mono text-lg font-bold tabular-nums text-ink">
                    {arrival.minutes === 0
                      ? "DUE"
                      : `${arrival.minutes} min`}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {arrivalData && (
          <p
            className={`mt-2 text-xs ${
              stale ? "text-red-700" : "text-ink/45"
            }`}
          >
            {stale ? "Data may be stale · " : ""}
            Updated{" "}
            {new Intl.DateTimeFormat("en", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }).format(new Date(arrivalData.observedAt))}
          </p>
        )}
      </section>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
      <header
        className={`mb-8 flex items-start justify-between pb-5 ${
          activeAlarm ? "" : "border-b border-ink/15"
        }`}
      >
        <div>
          <h1 className="flex items-center gap-2 text-xs font-bold tracking-[0.22em] text-signal uppercase">
            <Icon name="bus" className="size-5" />
            Athens Bus Alerts
          </h1>
          <p className="mt-2 text-sm text-ink/55">
            Pick stop · Pick bus · Get alert
          </p>
        </div>
        {activeAlarm && (
          <span className="pulse-dot mt-2 size-3 rounded-full bg-signal" title="Alert active" />
        )}
      </header>

      {activeAlarm && (
        <section
          aria-labelledby="active-alert-heading"
          className="mb-8 border border-signal/30 bg-signal/8 px-3 py-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 text-sm">
              <h2
                className="section-label mb-1 text-signal"
                id="active-alert-heading"
              >
                {activeAlarm.completedAt ? "Alert complete" : "Active alert"}
              </h2>
              <p>
                <strong>{activeAlarm.stopName}</strong> ·{" "}
                {activeAlarm.selectedLineIds.join(", ")} ·{" "}
                {formatThresholds(activeAlarm.optionalThresholds)} min
              </p>
              {activeAlarm.lastObservedMinutes !== null && (
                <p className="mt-1 text-ink/60">
                  {activeAlarm.completedAt
                    ? `${activeAlarm.lastObservedLineId ?? "Bus"} arrived`
                    : `Earliest ${activeAlarm.lastObservedLineId} in ${activeAlarm.lastObservedMinutes} min`}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {activeAlarm.completedAt && (
                <button
                  className="small-action"
                  onClick={() => void restartAlarm(activeAlarm)}
                  type="button"
                >
                  Restart
                </button>
              )}
              <button
                aria-label="Cancel alert"
                className="alert-dismiss flex size-14 shrink-0 items-center justify-center border-0 bg-transparent text-signal hover:text-signal"
                onClick={() => {
                  updateAlarm(null);
                  setStatus("Alert cancelled.");
                }}
                title="Cancel alert"
                type="button"
              >
                <svg
                  aria-hidden="true"
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="2.25"
                  suppressHydrationWarning
                  viewBox="0 0 24 24"
                >
                  <path d="M3 3 21 21M21 3 3 21" />
                </svg>
              </button>
            </div>
          </div>
          {selectedStop?.code === activeAlarm.stopCode &&
            !activeAlarm.completedAt &&
            renderLiveArrivals(
              "mt-4 border-t border-signal/20 pt-4",
              true,
            )}
        </section>
      )}

      {(favorites.length > 0 || canSaveFavorite) && (
        <section aria-labelledby="favorites-heading" className="mb-8">
          <div className="mb-3 flex items-center gap-2">
            <Icon name="star" className="size-4 text-signal" />
            <h2 id="favorites-heading" className="section-label">
              Favorites
            </h2>
          </div>
          <div className="divide-y divide-ink/10 border-y border-ink/15">
            {sortFavorites(favorites).map((favorite) => (
              <div
                className="flex items-center gap-3 py-3"
                key={favorite.id}
              >
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => void enableFavorite(favorite)}
                  type="button"
                >
                  <span className="block truncate font-semibold text-ink">
                    {favorite.name}
                  </span>
                  <span className="block truncate text-xs text-ink/55">
                    {favorite.stop.name} · {favorite.lineIds.join(", ")} ·{" "}
                    {formatThresholds(favorite.optionalThresholds)}
                  </span>
                </button>
                <button
                  className="small-action"
                  onClick={() => void enableFavorite(favorite)}
                  type="button"
                >
                  Enable
                </button>
                <details className="relative" data-favorite-menu>
                  <summary className="small-action cursor-pointer list-none">
                    •••
                  </summary>
                  <div className="absolute right-0 z-20 mt-1 w-32 border border-ink/15 bg-paper p-1 shadow-lg">
                    <button
                      className="menu-action"
                      onClick={(event) => {
                        renameFavorite(favorite);
                        closeFavoriteMenu(event.currentTarget);
                      }}
                    >
                      Rename
                    </button>
                    <button
                      className="menu-action"
                      onClick={(event) => {
                        updateFavorite(favorite);
                        closeFavoriteMenu(event.currentTarget);
                      }}
                    >
                      Update
                    </button>
                    <button
                      className="menu-action text-red-700"
                      onClick={(event) => {
                        deleteFavorite(favorite);
                        closeFavoriteMenu(event.currentTarget);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </details>
              </div>
            ))}
            {canSaveFavorite && (
              <div className="flex items-center gap-3 py-3">
                <label className="grid min-w-0 flex-1">
                  <input
                    aria-label="New favorite"
                    className="min-w-0 cursor-text border-0 bg-transparent p-0 font-semibold text-ink outline-none placeholder:text-ink/45"
                    maxLength={40}
                    onChange={(event) =>
                      setFavoriteName(event.target.value)
                    }
                    placeholder="New favorite"
                    ref={favoriteNameInputRef}
                    value={favoriteName}
                  />
                  <span className="truncate text-xs text-ink/55">
                    Draft · {selectedStop?.name} ·{" "}
                    {selectedLineIds.join(", ")} ·{" "}
                    {formatThresholds(thresholds)}
                  </span>
                </label>
                {favoriteName.trim() && (
                <button
                  aria-label="Save favorite"
                  className="small-action shrink-0"
                  onClick={saveFavorite}
                  type="button"
                >
                  Save
                </button>
                )}
                <button
                  aria-label="Edit new favorite"
                  className="small-action flex size-8 shrink-0 items-center justify-center"
                  onClick={() => favoriteNameInputRef.current?.focus()}
                  type="button"
                >
                  <Icon name="pencil" className="size-4 text-signal" />
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      <section aria-labelledby="stop-heading" className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <StepTitle
            controls="stop-step-content"
            expanded={expandedSteps.stop}
            id="stop-heading"
            label="01 · Stop"
            onToggle={() => toggleStep("stop")}
            selection={selectedStop?.name}
          />
          {expandedSteps.stop && (
            <button
              className="small-action flex items-center gap-1.5"
              disabled={isLocating}
              onClick={() => locate(true)}
              type="button"
            >
              <Icon name="locate" className="size-4" />
              {isLocating ? "Locating..." : "Find closest"}
            </button>
          )}
        </div>

        {expandedSteps.stop && (
        <div id="stop-step-content">
        <StopMap
          catalogError={catalogError}
          catalogLoading={catalogLoading}
          center={coordinates}
          onSelectStop={chooseStop}
          selectedStop={selectedStop}
          stops={catalogStops}
        />

        {coordinates && (
          <StopCombobox
            isLoading={
              catalogLoading ||
              isSearching ||
              (isLocating && nearbyStops.length === 0)
            }
            onQueryChange={updateStopQuery}
            onSelect={chooseStop}
            options={
              searchQuery.trim().length >= 2
                ? searchResults
                : nearbyStops
            }
            query={searchQuery}
            resultTotal={searchTotal}
          />
        )}

        {selectedStop && (
          <div className="mt-4 flex items-baseline justify-between border-l-2 border-signal pl-3">
            <p className="font-semibold text-ink">{selectedStop.name}</p>
            {selectedStop.distanceMeters > 0 && (
              <span className="font-mono text-sm text-ink/60">
                {formatDistance(selectedStop.distanceMeters)}
              </span>
            )}
          </div>
        )}
        </div>
        )}
      </section>

      {selectedStop && (
      <section aria-labelledby="buses-heading" className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <StepTitle
            controls="buses-step-content"
            expanded={expandedSteps.buses}
            id="buses-heading"
            label="02 · Buses"
            onToggle={() => toggleStep("buses")}
            selection={
              selectedLineIds.length > 0
                ? selectedLineIds.join(", ")
                : undefined
            }
          />
          {expandedSteps.buses && lines.length > 4 && (
            <div className="flex gap-2">
              <button
                className="small-action underline"
                onClick={() => setSelectedLineIds(lines.map((line) => line.lineId))}
                type="button"
              >
                Select all
              </button>
              <button
                className="small-action underline"
                onClick={() => setSelectedLineIds([])}
                type="button"
              >
                Clear
              </button>
            </div>
          )}
        </div>
        {expandedSteps.buses && (
        <div id="buses-step-content">
        {isLoadingStop ? (
          <p className="empty-copy">Loading lines...</p>
        ) : lines.length === 0 ? (
          <p className="empty-copy">No active lines were returned for this stop.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {lines.map((line) => {
              const selected = selectedLineIds.includes(line.lineId);
              return (
                <button
                  aria-pressed={selected}
                  className={selected ? "time-chip-selected" : "time-chip"}
                  key={line.lineId}
                  onClick={() => toggleLine(line.lineId)}
                  title={line.description}
                  type="button"
                >
                  {line.lineId}
                </button>
              );
            })}
          </div>
        )}
        </div>
        )}
      </section>
      )}

      {selectedLineIds.length > 0 && (
      <section aria-labelledby="notify-heading" className="mb-8">
        <div className="mb-3">
          <StepTitle
            controls="notify-step-content"
            expanded={expandedSteps.notify}
            id="notify-heading"
            label="03 · Notify"
            onToggle={() => toggleStep("notify")}
            selection={`${formatThresholds(thresholds)} min`}
          />
        </div>
        {expandedSteps.notify && (
        <div id="notify-step-content">
        <div className="flex flex-wrap gap-2">
          {OPTIONAL_THRESHOLDS.map((threshold) => {
            const selected = thresholds.includes(threshold);
            return (
              <button
                aria-pressed={selected}
                className={selected ? "time-chip-selected" : "time-chip"}
                key={threshold}
                onClick={() => toggleThreshold(threshold)}
                type="button"
              >
                {threshold} min
              </button>
            );
          })}
          <span className="time-chip-required" title="Always enabled">
            0 min · always
          </span>
        </div>

        {!activeAlarm && (
          <div className="mt-4">
            <button
              className="primary-button flex items-center gap-2"
              disabled={!selectedStop || selectedLineIds.length === 0}
              onClick={() => {
                if (selectedStop) {
                  void armWith(selectedStop, selectedLineIds, thresholds);
                }
              }}
              type="button"
            >
              <Icon name="bell" className="size-4" />
              Notify me
            </button>
          </div>
        )}
        </div>
        )}
      </section>
      )}

      {(error || catalogError || arrivalError || status) && (
        <div
          aria-live="polite"
          className={`mb-6 border-l-2 px-3 py-2 text-sm ${
            error || catalogError || arrivalError
              ? "border-red-600 bg-red-50 text-red-800"
              : "border-signal bg-signal/8 text-ink"
          }`}
        >
          {error ?? catalogError ?? arrivalError ?? status}
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/15 pt-4 text-xs text-ink/45">
        <p>Live data by OASA</p>
        <button
          className="small-action underline"
          onClick={forgetEverything}
          type="button"
        >
          Forget saved data
        </button>
      </footer>
    </main>
  );
}
