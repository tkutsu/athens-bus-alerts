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
import { haversineMeters } from "@/lib/distance";
import {
  clearStoredState,
  readStoredState,
  writeStoredState,
} from "@/lib/storage";
import { formatTransitName } from "@/lib/display";
import {
  OPTIONAL_THRESHOLDS,
  type ActiveAlarm,
  type ApiErrorPayload,
  type Arrival,
  type Coordinates,
  type Favorite,
  type LineAlertConfig,
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

type ActiveView = "stop" | "buses";
const TOAST_DISMISS_MS = 5_000;
const LOCATION_REFRESH_MS = 20_000;
const DEFAULT_ALERT_THRESHOLDS: OptionalThreshold[] = [3, 1];

function Icon({
  name,
  className = "size-5",
}: {
  name:
    | "bell"
    | "bus"
    | "pencil"
    | "star"
    | "stop";
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
    pencil: (
      <>
        <path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10z" />
        <path d="m14 7 3 3M4 20l1-4 3.5 3" />
      </>
    ),
    star: <path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2l-5-4.9 6.9-1z" />,
    stop: (
      <>
        <rect x="5" y="3" width="12" height="11" rx="1.5" />
        <path d="M8 7h6M8 10h6M11 14v7M8 21h6" />
      </>
    ),
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

/** Shows one temporary, dismissible message above the app. */
function Toast({
  isError,
  message,
  onDismiss,
}: {
  isError: boolean;
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

  return (
    <div
      aria-live={isError ? "assertive" : "polite"}
      className={`fixed bottom-20 left-1/2 z-[1000] flex w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 items-start gap-3 overflow-hidden px-4 py-3 text-sm shadow-lg ${
        isError
          ? "border border-red-700/20 bg-[#f3e3dc] text-red-900"
          : "border border-ink/15 bg-[#e5e1d7] text-ink"
      }`}
      role={isError ? "alert" : "status"}
    >
      <p className="min-w-0 flex-1">{message}</p>
      <button
        aria-label="Dismiss message"
        className="flex size-6 shrink-0 items-center justify-center text-current/70 hover:text-current"
        onClick={() => {
          setVisible(false);
          onDismiss();
        }}
        type="button"
      >
        <span aria-hidden="true" className="text-lg leading-none">
          ×
        </span>
      </button>
      <span
        aria-hidden="true"
        className={`toast-countdown absolute bottom-0 left-0 h-0.5 ${
          isError ? "bg-red-700/55" : "bg-signal/65"
        }`}
      />
    </div>
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
  return thresholds.join("/");
}

/** Formats short user-facing lists with a natural final conjunction. */
function formatList(items: readonly string[]) {
  return new Intl.ListFormat("en", {
    style: "long",
    type: "conjunction",
  }).format(items);
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
  const [mapFocus, setMapFocus] = useState<Coordinates | null>(null);
  const [selectedStop, setSelectedStop] = useState<StopSummary | null>(null);
  const [routes, setRoutes] = useState<ServingRoute[]>([]);
  const [lines, setLines] = useState<ServingLine[]>([]);
  const [lineAlerts, setLineAlerts] = useState<LineAlertConfig[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [activeAlarm, setActiveAlarmState] = useState<ActiveAlarm | null>(null);
  const activeAlarmRef = useRef<ActiveAlarm | null>(null);
  const hydrationStartedRef = useRef(false);
  const coordinatesRef = useRef<Coordinates | null>(null);
  const locationDeniedRef = useRef(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [isLoadingStop, setIsLoadingStop] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [favoriteName, setFavoriteName] = useState("");
  const [activeView, setActiveView] = useState<ActiveView>("stop");
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const favoritesDialogRef = useRef<HTMLDialogElement | null>(null);
  const selectedLineIds = useMemo(
    () => lineAlerts.map((lineAlert) => lineAlert.lineId),
    [lineAlerts],
  );
  const selectedRouteCodes = useMemo(
    () =>
      routes
        .filter((route) =>
          activeAlarm?.lineAlerts.some(
            (lineAlert) => lineAlert.lineId === route.lineId,
          ),
        )
        .map((route) => route.routeCode),
    [activeAlarm?.lineAlerts, routes],
  );

  const {
    data: arrivalData,
    error: arrivalError,
  } = useArrivalPolling(
    activeAlarm &&
      !activeAlarm.completedAt &&
      activeAlarm.stopCode === selectedStop?.code
      ? activeAlarm.stopCode
      : null,
    selectedRouteCodes,
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
      requestedLineAlerts: LineAlertConfig[] = [],
    ): Promise<{
      stop: StopSummary;
      validLineAlerts: LineAlertConfig[];
    } | null> => {
      setIsLoadingStop(true);
      setError(null);

      if (
        activeAlarmRef.current &&
        activeAlarmRef.current.stopCode !== requestedStop.code
      ) {
        updateAlarm(null);
        setStatus("Notifications for your previous stop are now off.");
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
        const validLineAlerts = requestedLineAlerts.filter((lineAlert) =>
          validLineIds.has(lineAlert.lineId),
        );

        setSelectedStop(stop);
        setRoutes(payload.routes);
        setLines(payload.lines);
        setLineAlerts(validLineAlerts);
        return { stop, validLineAlerts };
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
    setLineAlerts(stored.lineAlerts);
    setFavorites(stored.favorites);
    updateAlarm(stored.activeAlarm);
    setActiveView(
      stored.activeAlarm || stored.lineAlerts.length > 0
        ? "buses"
        : stored.selectedStop
          ? "buses"
          : "stop",
    );

    if (stored.selectedStop) {
      void loadStop(
        stored.selectedStop,
        stored.lineAlerts,
      ).finally(() => {
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
      version: 3,
      selectedStop: selectedStop ? stopReference(selectedStop) : null,
      lineAlerts,
      favorites,
      activeAlarm,
    });
  }, [
    activeAlarm,
    favorites,
    hydrated,
    lineAlerts,
    selectedStop,
  ]);

  useEffect(() => {
    const dialog = favoritesDialogRef.current;
    if (!dialog) return;
    if (favoritesOpen && !dialog.open) dialog.showModal();
    if (!favoritesOpen && dialog.open) dialog.close();
  }, [favoritesOpen]);

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
      const line = formatTransitName(event.lineId);
      const title =
        event.kind === "zero"
          ? `${line} is due now`
          : `${line} is ${event.minutes} min away`;
      const body = `${formatTransitName(alarm.stopName)} · ${
        event.kind === "warning"
          ? `${event.threshold}-minute alert`
          : "arrival alert"
      }`;
      const alertBehavior = {
        tag: `alarm-${alarm.id}-${line}`,
        renotify: true,
        vibrate: [300, 100, 300],
      };

      try {
        if ("serviceWorker" in navigator) {
          const registration = await navigator.serviceWorker.ready;
          await registration.showNotification(title, {
            body,
            icon: "/icon-192.png",
            badge: "/icon-192.png",
            ...alertBehavior,
          });
        } else {
          new Notification(title, {
            body,
            ...alertBehavior,
          });
        }
        setStatus(
          event.kind === "zero"
            ? `${line} is due now. Notifications for this bus are complete.`
            : `Notification sent: ${line} is ${event.minutes} min away.`,
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

      for (const event of evaluation.events) {
        await showAlert(event, alarm);
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
    const predictedZeroAt = activeAlarm?.lineAlerts
      .filter((lineAlert) => !lineAlert.completedAt)
      .map((lineAlert) => lineAlert.predictedZeroAt)
      .filter((value): value is string => Boolean(value))
      .sort()[0];
    if (!predictedZeroAt) return;

    const delay = Math.max(
      0,
      new Date(predictedZeroAt).getTime() - Date.now(),
    );
    const timeout = window.setTimeout(() => {
      const alarm = activeAlarmRef.current;
      if (alarm) {
        void processAlarm(alarm, [], new Date());
      }
    }, Math.min(delay, 2_147_000_000));

    return () => window.clearTimeout(timeout);
  }, [activeAlarm?.lineAlerts, processAlarm]);

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
      setError("Allow browser notifications to continue.");
      return false;
    }
    return true;
  }

  /** Arms an independent alert schedule for every selected bus. */
  async function armWith(
    stop: StopSummary,
    alarmLineAlerts: LineAlertConfig[],
  ) {
    if (!(await ensureNotificationPermission())) return;

    const lineIds = alarmLineAlerts.map((lineAlert) => lineAlert.lineId);
    const alarm: ActiveAlarm = {
      id: crypto.randomUUID(),
      stopCode: stop.code,
      stopName: stop.name,
      lineAlerts: alarmLineAlerts.map((lineAlert) => ({
        ...lineAlert,
        optionalThresholds: [...lineAlert.optionalThresholds],
        firedThresholds: [],
        predictedZeroAt: null,
        lastObservedMinutes: null,
        completedAt: null,
      })),
      armedAt: new Date().toISOString(),
      completedAt: null,
    };

    updateAlarm(alarm);
    setActiveView("buses");
    setStatus(
      `Notifications are on for ${formatList(
        lineIds.map(formatTransitName),
      )}.`,
    );
  }

  /** Re-arms a completed alert with its previous stop, buses, and times. */
  async function restartAlarm(alarm: ActiveAlarm) {
    const currentLineIds = new Set(lines.map((line) => line.lineId));
    const savedLineAlerts = alarm.lineAlerts.map((lineAlert) => ({
      lineId: lineAlert.lineId,
      optionalThresholds: lineAlert.optionalThresholds,
    }));
    const loaded =
      selectedStop?.code === alarm.stopCode
        ? {
            stop: selectedStop,
            validLineAlerts: savedLineAlerts.filter((lineAlert) =>
              currentLineIds.has(lineAlert.lineId),
            ),
          }
        : await loadStop(
            { code: alarm.stopCode, name: alarm.stopName },
            savedLineAlerts,
          );

    if (!loaded || loaded.validLineAlerts.length === 0) {
      setError("The saved buses no longer serve this stop.");
      return;
    }

    setLineAlerts(loaded.validLineAlerts);
    await armWith(loaded.stop, loaded.validLineAlerts);
  }

  /** Reads the device location used for client-side stop ordering. */
  const locate = useCallback(
    (force = false) => {
      if (locationDeniedRef.current && !force) return;

      const showProgress = force || coordinatesRef.current === null;
      if (showProgress) {
        setIsLocating(true);
      }
      if (force) setError(null);

      if (!navigator.geolocation) {
        if (force) {
          setError("Location is not supported. Choose a stop on the map.");
        }
        setIsLocating(false);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const nextCoordinates = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          };
          locationDeniedRef.current = false;
          coordinatesRef.current = nextCoordinates;
          setCoordinates(nextCoordinates);
          if (force) setMapFocus(nextCoordinates);
          if (force) setStatus("Map centered on your location.");
          if (showProgress) setIsLocating(false);
        },
        (locationError) => {
          if (locationError.code === 1) locationDeniedRef.current = true;
          if (showProgress) {
            setIsLocating(false);
          }
          if (force) {
            const messages: Record<number, string> = {
              1: "Location was denied. Choose a stop on the map.",
              2: "Your location is unavailable. Try again or use the map.",
              3: "Location timed out. Try again or use the map.",
            };
            setError(
              messages[locationError.code] ?? "Could not get your location.",
            );
          }
        },
        {
          enableHighAccuracy: false,
          maximumAge: force ? 0 : 20_000,
          timeout: 10_000,
        },
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
    setLineAlerts((current) =>
      current.some((lineAlert) => lineAlert.lineId === lineId)
        ? current.filter((lineAlert) => lineAlert.lineId !== lineId)
        : [
            ...current,
            {
              lineId,
              optionalThresholds: [...DEFAULT_ALERT_THRESHOLDS],
            },
          ],
    );
  }

  function toggleThreshold(
    lineId: string,
    threshold: OptionalThreshold,
  ) {
    setLineAlerts((current) =>
      current.map((lineAlert) =>
        lineAlert.lineId !== lineId
          ? lineAlert
          : {
              ...lineAlert,
              optionalThresholds: lineAlert.optionalThresholds.includes(
                threshold,
              )
                ? lineAlert.optionalThresholds.filter(
                    (candidate) => candidate !== threshold,
                  )
                : [...lineAlert.optionalThresholds, threshold].sort(
                    (a, b) => b - a,
                  ),
            },
      ),
    );
  }

  function openFavorites() {
    setFavoritesOpen(true);
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
      lineAlerts,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastEnabledAt: existing?.lastEnabledAt ?? null,
    };
    setFavorites((current) => [
      ...current.filter((item) => item.id !== favorite.id),
      favorite,
    ]);
    setFavoriteName("");
    setFavoritesOpen(false);
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

    const loaded = await loadStop(favorite.stop, favorite.lineAlerts);
    if (!loaded) return;

    if (loaded.validLineAlerts.length === 0) {
      setError(
        `None of the saved lines for "${favorite.name}" currently serve this stop.`,
      );
      return;
    }

    if (loaded.validLineAlerts.length !== favorite.lineAlerts.length) {
      setStatus(
        "Some saved buses no longer serve this stop, so we removed them.",
      );
    }

    const enabledAt = new Date().toISOString();
    setFavorites((current) =>
      current.map((item) =>
        item.id === favorite.id
          ? { ...item, lastEnabledAt: enabledAt }
          : item,
      ),
    );
    setFavoritesOpen(false);
    setActiveView("buses");
    await armWith(loaded.stop, loaded.validLineAlerts);
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
              lineAlerts,
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
    setLineAlerts([]);
    setFavorites([]);
    updateAlarm(null);
    setActiveView("stop");
    setFavoritesOpen(false);
    setStatus("Your saved data was cleared.");
  }

  const canSaveFavorite =
    selectedStop !== null && selectedLineIds.length > 0;
  const shouldAnimateBell =
    selectedStop !== null &&
    lineAlerts.length > 0 &&
    lineAlerts.some(
      (lineAlert) => lineAlert.optionalThresholds.length > 0,
    );
  const toastMessage = error ?? catalogError ?? arrivalError ?? status;
  const toastIsError = Boolean(error || catalogError || arrivalError);

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-4 pt-6 pb-10 sm:px-6 sm:pt-10">
      <header className="mb-5 flex items-start justify-between">
        <h1 className="flex items-center gap-2 text-xs font-bold tracking-[0.22em] text-signal uppercase">
          <Icon name="bus" className="size-5" />
          Athens Bus Notifications
        </h1>
        <button
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink/55 transition hover:text-signal"
          onClick={openFavorites}
          type="button"
        >
          Favorites
          <Icon name="star" className="size-4 shrink-0 -translate-y-px" />
        </button>
      </header>

      <nav
        aria-label="Notification setup"
        className="workflow-tabs"
      >
        <div className="contents" role="tablist">
          <button
            aria-controls="stop-tab-panel"
            aria-selected={activeView === "stop"}
            className="workflow-tab min-w-0 flex-1"
            id="stop-tab"
            onClick={() => setActiveView("stop")}
            role="tab"
            type="button"
          >
            <span className="truncate">
              {selectedStop
                ? `${formatTransitName(selectedStop.name)}`
                : "Pick Stop"}
            </span>
            <Icon name="stop" className="size-4 shrink-0" />
          </button>
          <button
            aria-controls="buses-tab-panel"
            aria-selected={activeView === "buses"}
            className="workflow-tab min-w-0 flex-1"
            disabled={!selectedStop}
            id="buses-tab"
            onClick={() => setActiveView("buses")}
            role="tab"
            title={
              selectedLineIds.length > 0
                ? selectedLineIds.map(formatTransitName).join(", ")
                : undefined
            }
            type="button"
          >
            <span className="truncate">
              {selectedLineIds.length > 0
                ? `${selectedLineIds
                    .map(formatTransitName)
                    .join(" ")}`
                : "Pick Bus"}
            </span>
            <Icon name="bus" className="size-4 shrink-0" />
          </button>
        </div>
        <button
          className={`workflow-tab workflow-notify flex-1 ${
            activeAlarm ? "workflow-notify-active" : ""
          }`}
          disabled={
            !activeAlarm && (!selectedStop || lineAlerts.length === 0)
          }
          onClick={() => {
            if (activeAlarm) {
              updateAlarm(null);
              setStatus("Notifications are off.");
            } else if (selectedStop) {
              void armWith(selectedStop, lineAlerts);
            }
          }}
          type="button"
        >
          <span>{activeAlarm ? "Cancel" : "Notify"}</span>
          {activeAlarm ? (
            <span aria-hidden="true" className="text-lg leading-none">
              ×
            </span>
          ) : (
            <Icon
              name="bell"
              className={`size-4 shrink-0 ${
                shouldAnimateBell ? "notify-bell-ready" : ""
              }`}
            />
          )}
        </button>
      </nav>

      {activeView === "stop" && (
        <section
          aria-labelledby="stop-tab"
          className="workflow-panel"
          id="stop-tab-panel"
          role="tabpanel"
          tabIndex={0}
        >
          <StopMap
            catalogError={catalogError}
            catalogLoading={catalogLoading}
            center={coordinates}
            focusCenter={mapFocus}
            isLocating={isLocating}
            onRefreshLocation={() => locate(true)}
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
        </section>
      )}

      {activeView === "buses" && selectedStop && (
        <section
          aria-labelledby="buses-tab"
          className="workflow-panel"
          id="buses-tab-panel"
          role="tabpanel"
          tabIndex={0}
        >
          {activeAlarm ? (
            <div
              aria-label={
                activeAlarm.completedAt
                  ? "Alert complete"
                  : "Active alert"
              }
              className="alert-card alert-card-active"
              role="region"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="section-label text-signal">
                  {activeAlarm.completedAt
                    ? "Alerts complete"
                    : "Active alerts"}
                </h2>
                {activeAlarm.completedAt ? (
                  <button
                    className="small-action shrink-0"
                    onClick={() => void restartAlarm(activeAlarm)}
                    type="button"
                  >
                    Restart
                  </button>
                ) : (
                  <span
                    className="pulse-dot mt-0.5 size-3 shrink-0 rounded-full bg-signal"
                    title="Alert active"
                  />
                )}
              </div>

              <div className="mt-4 divide-y divide-ink/10">
                {activeAlarm.lineAlerts.map((lineAlert) => {
                  const line = lines.find(
                    (candidate) => candidate.lineId === lineAlert.lineId,
                  );
                  return (
                    <div
                      className="py-4"
                      data-alert-line={lineAlert.lineId}
                      key={lineAlert.lineId}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="arrival-line-selected">
                          {formatTransitName(lineAlert.lineId)}
                        </span>
                        <span
                          className={`shrink-0 font-mono text-sm font-bold ${
                            lineAlert.completedAt
                              ? "text-signal"
                              : "text-ink/65"
                          }`}
                        >
                          {lineAlert.completedAt
                            ? "ARRIVED"
                            : lineAlert.lastObservedMinutes === null
                              ? "WAITING"
                          : `${lineAlert.lastObservedMinutes} min`}
                        </span>
                      </div>
                      <p className="mt-1.5 text-left text-sm leading-snug whitespace-normal text-ink/60">
                        {formatTransitName(
                          line?.description ?? `Bus ${lineAlert.lineId}`,
                        )}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {OPTIONAL_THRESHOLDS.map((threshold) => (
                          <span
                            className={
                              lineAlert.optionalThresholds.includes(
                                threshold,
                              )
                                ? "time-chip-selected"
                                : "time-chip time-chip-muted"
                            }
                            key={threshold}
                          >
                            {threshold} min
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

            </div>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="section-label">Buses at this stop</h2>
                  <p className="mt-1 text-sm text-ink/55">
                    Select a bus to show its alert times.
                  </p>
                </div>
                {lines.length > 4 && (
                  <div className="flex shrink-0 gap-2">
                    <button
                      className="small-action underline"
                      onClick={() =>
                        setLineAlerts(
                          lines.map((line) => ({
                            lineId: line.lineId,
                            optionalThresholds: [
                              ...DEFAULT_ALERT_THRESHOLDS,
                            ],
                          })),
                        )
                      }
                      type="button"
                    >
                      Select all
                    </button>
                    <button
                      className="small-action underline"
                      onClick={() => setLineAlerts([])}
                      type="button"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
              {isLoadingStop ? (
                <p className="empty-copy">Loading lines...</p>
              ) : lines.length === 0 ? (
                <p className="empty-copy">
                  No active lines were returned for this stop.
                </p>
              ) : (
                <div className="divide-y divide-ink/10">
                  {lines.map((line) => {
                    const lineAlert = lineAlerts.find(
                      (candidate) => candidate.lineId === line.lineId,
                    );
                    const selected = Boolean(lineAlert);
                    return (
                      <div className="py-3" key={line.lineId}>
                        <button
                          aria-expanded={selected}
                          aria-pressed={selected}
                          className="w-full text-left"
                          onClick={() => toggleLine(line.lineId)}
                          type="button"
                        >
                          <span className="flex items-center justify-between gap-3">
                            <span
                              className={
                                selected
                                  ? "arrival-line-selected"
                                  : "arrival-line"
                              }
                            >
                              {formatTransitName(line.lineId)}
                            </span>
                            <span
                              aria-hidden="true"
                              className="text-ink/45"
                            >
                              {selected ? "−" : "+"}
                            </span>
                          </span>
                          <span className="mt-1.5 block text-left text-sm leading-snug whitespace-normal text-ink/65">
                            {formatTransitName(line.description)}
                          </span>
                        </button>
                        {lineAlert && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {OPTIONAL_THRESHOLDS.map((threshold) => {
                              const thresholdSelected =
                                lineAlert.optionalThresholds.includes(
                                  threshold,
                                );
                              return (
                                <button
                                  aria-label={`${formatTransitName(
                                    line.lineId,
                                  )}: ${threshold} min`}
                                  aria-pressed={thresholdSelected}
                                  className={
                                    thresholdSelected
                                      ? "time-chip-selected"
                                      : "time-chip"
                                  }
                                  key={threshold}
                                  onClick={() =>
                                    toggleThreshold(
                                      line.lineId,
                                      threshold,
                                    )
                                  }
                                  type="button"
                                >
                                  {threshold} min
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

        </section>
      )}

      <dialog
        aria-labelledby="favorites-heading"
        className="favorites-dialog"
        onCancel={(event) => {
          event.preventDefault();
          setFavoritesOpen(false);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            setFavoritesOpen(false);
          }
        }}
        onClose={() => setFavoritesOpen(false)}
        ref={favoritesDialogRef}
      >
        <div className="favorites-sheet">
          <div className="flex items-center justify-between gap-3 border-b border-ink/15 pb-4">
            <div className="flex items-center gap-2">
              <Icon name="star" className="size-5 text-signal" />
              <h2
                className="section-label text-signal"
                id="favorites-heading"
              >
                Favorites
              </h2>
            </div>
            <button
              aria-label="Close favorites"
              className="flex size-10 items-center justify-center text-xl text-ink/60 hover:text-ink"
              onClick={() => setFavoritesOpen(false)}
              type="button"
            >
              ×
            </button>
          </div>

          {canSaveFavorite && (
            <form
              className="border-b border-ink/15 py-4"
              onSubmit={(event) => {
                event.preventDefault();
                saveFavorite();
              }}
            >
              <label
                className="section-label"
                htmlFor="favorite-name"
              >
                Save current setup
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  className="field min-w-0 flex-1"
                  id="favorite-name"
                  maxLength={40}
                  onChange={(event) =>
                    setFavoriteName(event.target.value)
                  }
                  placeholder="Favorite name"
                  value={favoriteName}
                />
                <button
                  className="primary-button"
                  disabled={!favoriteName.trim()}
                  type="submit"
                >
                  Save
                </button>
              </div>
              <p className="mt-2 text-xs text-ink/55">
                {selectedStop
                  ? formatTransitName(selectedStop.name)
                  : null}{" "}
                ·{" "}
                {lineAlerts
                  .map(
                    (lineAlert) =>
                      `${formatTransitName(
                        lineAlert.lineId,
                      )} ${formatThresholds(lineAlert.optionalThresholds)}`,
                  )
                  .join(" · ")}
              </p>
            </form>
          )}

          <div className="max-h-[55vh] overflow-y-auto">
            {favorites.length === 0 ? (
              <div className="py-8 text-center text-sm text-ink/45">
                <p>No favorites saved yet.</p>
                <p className="mt-1">
                  You can save a new favorite when you reach the Notify
                  Me tab.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-ink/10">
                {sortFavorites(favorites).map((favorite) => (
                  <div
                    className="flex items-center gap-3 py-4"
                    key={favorite.id}
                  >
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => void enableFavorite(favorite)}
                      type="button"
                    >
                      <span className="block truncate font-semibold">
                        {favorite.name}
                      </span>
                      <span className="block truncate text-xs text-ink/55">
                        {formatTransitName(favorite.stop.name)} ·{" "}
                        {favorite.lineAlerts
                          .map(
                            (lineAlert) =>
                              `${formatTransitName(
                                lineAlert.lineId,
                              )} ${formatThresholds(
                                lineAlert.optionalThresholds,
                              )}`,
                          )
                          .join(" · ")}
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
                      <summary className="small-action list-none">
                        •••
                      </summary>
                      <div className="absolute right-0 z-20 mt-1 w-32 border border-ink/15 bg-paper p-1 shadow-lg">
                        <button
                          className="menu-action"
                          onClick={(event) => {
                            renameFavorite(favorite);
                            closeFavoriteMenu(event.currentTarget);
                          }}
                          type="button"
                        >
                          Rename
                        </button>
                        <button
                          className="menu-action"
                          onClick={(event) => {
                            updateFavorite(favorite);
                            closeFavoriteMenu(event.currentTarget);
                          }}
                          type="button"
                        >
                          Update
                        </button>
                        <button
                          className="menu-action text-red-700"
                          onClick={(event) => {
                            deleteFavorite(favorite);
                            closeFavoriteMenu(event.currentTarget);
                          }}
                          type="button"
                        >
                          Delete
                        </button>
                      </div>
                    </details>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </dialog>

      {toastMessage && (
        <Toast
          isError={toastIsError}
          key={toastMessage}
          message={toastMessage}
          onDismiss={() => {
            setError(null);
            setStatus(null);
          }}
        />
      )}

      <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 pt-4 text-xs text-ink/45">
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
