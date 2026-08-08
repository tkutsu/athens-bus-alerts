"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  evaluateSubscriptions,
  type AlertEvent,
  type CandidateArrival,
} from "@/lib/alerts";
import { isAbortError } from "@/lib/client-api";
import { haversineMeters } from "@/lib/distance";
import {
  clearStoredState,
  createSubscription,
  readStoredState,
  writeStoredState,
} from "@/lib/storage";
import { StopRouteLoader } from "@/lib/stop-routes";
import { formatTransitName } from "@/lib/display";
import type {
  Coordinates,
  Favorite,
  LineSubscription,
  RouteDetails,
  ServingRoute,
  StopSummary,
  UserLocation,
} from "@/lib/types";
import { findClosestStops, searchStopNames } from "@/lib/stop-catalog";
import { useArrivalPolling } from "@/hooks/use-arrival-polling";
import { useStopCatalog } from "@/hooks/use-stop-catalog";
import { useCatchPolling } from "@/hooks/use-catch-polling";
import { useRouteDetails } from "@/hooks/use-route-details";
import { StopCombobox } from "@/components/stop-combobox";
import { StopMap } from "@/components/stop-map";
import { AlternateStopDialog } from "@/components/alternate-stop-dialog";
import {
  ArrivalTimeline,
  type TimelineArrival,
} from "@/components/arrival-timeline";
import {
  alternateStopCandidates,
  bestAlternateStop,
  catchOptionsForStop,
  representativeCatchOption,
  type BetterStopOption,
} from "@/lib/catch-options";
import {
  updateVehicleConfidence,
  type VehicleConfidenceRecord,
} from "@/lib/vehicle-confidence";
import { estimateWalk, isUsableLocation } from "@/lib/walking";

const TOAST_DISMISS_MS = 5_000;
const LOCATION_MIN_MOVEMENT_METERS = 10;

function Icon({
  name,
  className = "size-5",
}: {
  name: "bus" | "moon" | "star" | "sun";
  className?: string;
}) {
  const paths = {
    bus: (
      <>
        <path d="M8 6v6m8-6v6M6 17h12M7 21v-2m10 2v-2" />
        <rect x="4" y="3" width="16" height="16" rx="2" />
        <path d="M8 15h.01M16 15h.01" />
      </>
    ),
    star: (
      <path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2l-5-4.9 6.9-1z" />
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="3.5" />
        <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </>
    ),
    moon: <path d="M20.2 15.3A8.5 8.5 0 0 1 8.7 3.8 8.5 8.5 0 1 0 20.2 15.3Z" />,
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

type Theme = "light" | "dark";
const THEME_CHANGE_EVENT = "oasa-theme-change";

function currentTheme(): Theme | null {
  if (typeof document === "undefined") return null;
  return document.documentElement.dataset.theme === "dark"
    ? "dark"
    : "light";
}

function subscribeToTheme(onThemeChange: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, onThemeChange);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange);
}

/** Applies and persists the user's explicit color-theme choice. */
function ThemeSwitch() {
  const theme = useSyncExternalStore(
    subscribeToTheme,
    currentTheme,
    () => null,
  );

  const toggleTheme = () => {
    const root = document.documentElement;
    const currentTheme = root.dataset.theme === "dark" ? "dark" : "light";
    const nextTheme: Theme = currentTheme === "dark" ? "light" : "dark";
    root.dataset.theme = nextTheme;
    try {
      window.localStorage.setItem("oasa-theme", nextTheme);
    } catch {
      // The active theme still works when storage is unavailable.
    }
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  };

  const dark = theme === "dark";

  return (
    <button
      aria-checked={dark}
      aria-label={
        theme ? `Use ${dark ? "light" : "dark"} mode` : "Toggle color theme"
      }
      className="theme-switch"
      onClick={toggleTheme}
      role="switch"
      title={
        theme ? `Use ${dark ? "light" : "dark"} mode` : "Toggle color theme"
      }
      type="button"
    >
      <span aria-hidden="true" className="theme-switch-icon theme-switch-sun">
        <Icon className="size-3.5" name="sun" />
      </span>
      <span aria-hidden="true" className="theme-switch-icon theme-switch-moon">
        <Icon className="size-3.5" name="moon" />
      </span>
      <span aria-hidden="true" className="theme-switch-thumb" />
    </button>
  );
}

/** Shows one temporary, dismissible message above the app. */
function Toast({
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

function stopReference(stop: StopSummary) {
  return { code: stop.code, name: stop.name };
}

function sortFavorites(favorites: readonly Favorite[]): Favorite[] {
  return [...favorites].sort(
    (a, b) =>
      (b.lastEnabledAt ?? "").localeCompare(a.lastEnabledAt ?? "") ||
      a.name.localeCompare(b.name, "en"),
  );
}

function distanceLabel(distanceMeters: number): string {
  return distanceMeters < 1_000
    ? `${Math.round(distanceMeters)} m away`
    : `${(distanceMeters / 1_000).toFixed(1)} km away`;
}

export function TickerApp() {
  const [hydrated, setHydrated] = useState(false);
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [mapFocus, setMapFocus] = useState<Coordinates | null>(null);
  const [selectedStop, setSelectedStop] = useState<StopSummary | null>(null);
  const selectedStopRef = useRef<StopSummary | null>(null);
  const [routes, setRoutes] = useState<ServingRoute[]>([]);
  const [subscriptions, setSubscriptionsState] = useState<
    LineSubscription[]
  >([]);
  const subscriptionsRef = useRef<LineSubscription[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [pickerOpen, setPickerOpen] = useState(true);
  const hydrationStartedRef = useRef(false);
  const stopLoadVersionRef = useRef(0);
  const stopRouteLoaderRef = useRef(new StopRouteLoader());
  const coordinatesRef = useRef<Coordinates | null>(null);
  const locationDeniedRef = useRef(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [urgentMessage, setUrgentMessage] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [isLoadingStop, setIsLoadingStop] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [favoriteName, setFavoriteName] = useState("");
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [favoriteMenu, setFavoriteMenu] = useState<{
    favoriteId: string;
    left: number;
    top: number;
  } | null>(null);
  const [focusedRouteCode, setFocusedRouteCode] = useState<string | null>(null);
  const [openAlternate, setOpenAlternate] =
    useState<BetterStopOption | null>(null);
  const favoritesDialogRef = useRef<HTMLDialogElement | null>(null);
  const confidenceRecordsRef = useRef(
    new Map<string, VehicleConfidenceRecord>(),
  );
  const confidenceStopCodeRef = useRef<string | null>(null);

  const updateSubscriptions = useCallback(
    (next: LineSubscription[] | ((current: LineSubscription[]) => LineSubscription[])) => {
      setSubscriptionsState((current) => {
        const value = typeof next === "function" ? next(current) : next;
        subscriptionsRef.current = value;
        return value;
      });
    },
    [],
  );

  const selectedLineIds = useMemo(
    () => [...new Set(subscriptions.map((subscription) => subscription.lineId))],
    [subscriptions],
  );
  const selectedRouteCodes = useMemo(() => {
    const explicit = new Set(
      subscriptions.flatMap((subscription) =>
        subscription.routeCode ? [subscription.routeCode] : [],
      ),
    );
    const wildcardLines = new Set(
      subscriptions.flatMap((subscription) =>
        subscription.routeCode ? [] : [subscription.lineId],
      ),
    );
    for (const route of routes) {
      if (wildcardLines.has(route.lineId)) explicit.add(route.routeCode);
    }
    return [...explicit];
  }, [routes, subscriptions]);

  const {
    data: arrivalData,
    error: arrivalError,
    isLoading: arrivalsLoading,
  } = useArrivalPolling(
    pickerOpen ? null : (selectedStop?.code ?? null),
    selectedRouteCodes,
  );
  const {
    stops: catalogStops,
    error: catalogError,
    isLoading: catalogLoading,
  } = useStopCatalog();
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const nearbyStops = useMemo(
    () => (coordinates ? findClosestStops(catalogStops, coordinates) : []),
    [catalogStops, coordinates],
  );
  const searchResult = useMemo(
    () =>
      searchStopNames(
        catalogStops,
        deferredSearchQuery,
        coordinates ?? undefined,
      ),
    [catalogStops, coordinates, deferredSearchQuery],
  );
  const isSearching = searchQuery !== deferredSearchQuery;
  const routeCodesForDetails = useMemo(
    () => selectedRouteCodes,
    [selectedRouteCodes],
  );
  const { details: routeDetails } = useRouteDetails(routeCodesForDetails);

  /** Applies a fresh device position and keeps selected-stop distance in sync. */
  const applyPosition = useCallback(
    (position: GeolocationPosition, force = false): boolean => {
      const nextCoordinates = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      const previousCoordinates = coordinatesRef.current;
      if (
        !force &&
        previousCoordinates &&
        haversineMeters(previousCoordinates, nextCoordinates) <
          LOCATION_MIN_MOVEMENT_METERS
      ) {
        return false;
      }

      locationDeniedRef.current = false;
      coordinatesRef.current = nextCoordinates;
      setCoordinates(nextCoordinates);
      if (!previousCoordinates) setMapFocus(nextCoordinates);
      setUserLocation({
        ...nextCoordinates,
        accuracyMeters: position.coords.accuracy,
        observedAt: new Date(position.timestamp).toISOString(),
      });
      setSelectedStop((currentStop) => {
        if (!currentStop) return currentStop;
        const nextStop = {
          ...currentStop,
          distanceMeters: haversineMeters(nextCoordinates, currentStop),
        };
        selectedStopRef.current = nextStop;
        return nextStop;
      });
      return true;
    },
    [],
  );

  /** Loads one stop and validates any subscriptions supplied by a favorite. */
  const loadStop = useCallback(
    async (
      requestedStop: Pick<StopSummary, "code" | "name"> &
        Partial<StopSummary>,
      requestedSubscriptions?: LineSubscription[],
    ): Promise<{ stop: StopSummary; validLineIds: string[] } | null> => {
      const loadVersion = ++stopLoadVersionRef.current;
      setIsLoadingStop(true);
      setError(null);

      try {
        const catalogStop = catalogStops.find(
          (stop) => stop.code === requestedStop.code,
        );
        const latitude = requestedStop.latitude ?? catalogStop?.latitude;
        const longitude = requestedStop.longitude ?? catalogStop?.longitude;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          throw new Error("That stop is no longer in the stop catalogue.");
        }

        const servingRoutes = await stopRouteLoaderRef.current.load(
          requestedStop.code,
        );

        if (loadVersion !== stopLoadVersionRef.current) return null;

        const stopCoordinates = { latitude: latitude!, longitude: longitude! };
        const currentCoordinates = coordinatesRef.current;
        const distanceMeters =
          currentCoordinates
            ? haversineMeters(currentCoordinates, stopCoordinates)
            : (requestedStop.distanceMeters ?? 0);
        const stop: StopSummary = {
          code: requestedStop.code,
          name: requestedStop.name || catalogStop?.name || "Unknown",
          street: requestedStop.street ?? null,
          ...stopCoordinates,
          distanceMeters,
        };
        const validLineIds = new Set(servingRoutes.map((route) => route.lineId));
        const validRouteCodes = new Set(
          servingRoutes.map((route) => route.routeCode),
        );
        const changingStop =
          selectedStopRef.current?.code !== undefined &&
          selectedStopRef.current.code !== stop.code;

        let nextSubscriptions: LineSubscription[];
        if (requestedSubscriptions) {
          nextSubscriptions = requestedSubscriptions.filter(
            (subscription) =>
              subscription.routeCode
                ? validRouteCodes.has(subscription.routeCode)
                : validLineIds.has(subscription.lineId),
          );
        } else if (changingStop) {
          nextSubscriptions = [];
        } else {
          nextSubscriptions = subscriptionsRef.current.filter(
            (subscription) =>
              subscription.routeCode
                ? validRouteCodes.has(subscription.routeCode)
                : validLineIds.has(subscription.lineId),
          );
        }

        selectedStopRef.current = stop;
        setSelectedStop(stop);
        setRoutes(servingRoutes);
        setFocusedRouteCode(
          nextSubscriptions.find((subscription) => subscription.routeCode)
            ?.routeCode ?? null,
        );
        setOpenAlternate(null);
        updateSubscriptions(nextSubscriptions);
        setPickerOpen(false);
        return {
          stop,
          validLineIds: nextSubscriptions.map(
            (subscription) => subscription.lineId,
          ),
        };
      } catch (loadError) {
        if (
          isAbortError(loadError) ||
          loadVersion !== stopLoadVersionRef.current
        ) {
          return null;
        }
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load that stop.",
        );
        return null;
      } finally {
        if (loadVersion === stopLoadVersionRef.current) {
          setIsLoadingStop(false);
        }
      }
    },
    [catalogStops, updateSubscriptions],
  );

  /* eslint-disable react-hooks/set-state-in-effect -- hydrate browser storage after SSR */
  useEffect(() => {
    if (hydrationStartedRef.current || catalogLoading) return;
    hydrationStartedRef.current = true;

    const stored = readStoredState();
    const restorableSubscriptions =
      "Notification" in window && Notification.permission === "denied"
        ? []
        : stored.subscriptions;
    updateSubscriptions(restorableSubscriptions);
    setFavorites(stored.favorites);

    if (stored.selectedStop) {
      void loadStop(stored.selectedStop, restorableSubscriptions).finally(() =>
        setHydrated(true),
      );
    } else {
      setHydrated(true);
    }
  }, [catalogLoading, loadStop, updateSubscriptions]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js");
    }
  }, []);

  useEffect(
    () => () => {
      stopLoadVersionRef.current += 1;
      stopRouteLoaderRef.current.abort();
    },
    [],
  );

  useEffect(() => {
    if (!hydrated) return;
    writeStoredState({
      version: 5,
      selectedStop: selectedStop ? stopReference(selectedStop) : null,
      subscriptions,
      favorites,
    });
  }, [favorites, hydrated, selectedStop, subscriptions]);

  useEffect(() => {
    const dialog = favoritesDialogRef.current;
    if (!dialog) return;
    if (favoritesOpen && !dialog.open) dialog.showModal();
    if (!favoritesOpen && dialog.open) dialog.close();
  }, [favoritesOpen]);

  useEffect(() => {
    if (!favoriteMenu) return;

    const closeMenu = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest("[data-favorite-menu-popup]")) return;
      if (event.target.closest("[data-favorite-menu-trigger]")) return;
      setFavoriteMenu(null);
    };
    const closeOnViewportChange = () => setFavoriteMenu(null);

    document.addEventListener("pointerdown", closeMenu);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [favoriteMenu]);

  const candidateStopsByRoute = useMemo(() => {
    const result = new Map<string, readonly string[]>();
    if (!selectedStop || !isUsableLocation(userLocation)) return result;
    for (const routeCode of selectedRouteCodes) {
      const detail = routeDetails.get(routeCode);
      if (!detail) continue;
      result.set(
        routeCode,
        alternateStopCandidates(
          detail.stops,
          selectedStop.code,
          userLocation,
        ).map((stop) => stop.code),
      );
    }
    return result;
  }, [routeDetails, selectedRouteCodes, selectedStop, userLocation]);
  const { states: catchStates } = useCatchPolling(candidateStopsByRoute);
  const [confidenceArrivals, setConfidenceArrivals] = useState<
    ReturnType<typeof updateVehicleConfidence>["arrivals"]
  >([]);
  const [confidenceClock, setConfidenceClock] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(
      () => setConfidenceClock(Date.now()),
      30_000,
    );
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!arrivalData) return;
    const timeout = window.setTimeout(() => {
      const telemetry = [...catchStates.values()].flatMap(
        (state) => state.vehicles,
      );
      const sameStop = confidenceStopCodeRef.current === selectedStop?.code;
      const update = updateVehicleConfidence(
        sameStop ? confidenceRecordsRef.current : new Map(),
        arrivalData.arrivals,
        arrivalData.observedAt,
        telemetry,
        confidenceClock,
      );
      confidenceStopCodeRef.current = selectedStop?.code ?? null;
      confidenceRecordsRef.current = update.records;
      setConfidenceArrivals(update.arrivals);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [arrivalData, catchStates, confidenceClock, selectedStop?.code]);

  const timelineArrivals = useMemo<TimelineArrival[]>(() => {
    const routesByCode = new Map(
      routes.map((route) => [route.routeCode, route]),
    );
    return confidenceArrivals.flatMap((arrival) => {
      const route = routesByCode.get(arrival.routeCode);
      return route
        ? [
            {
              ...arrival,
              vehicleKey: `${arrival.routeCode}:${arrival.vehicleId}`,
              lineId: route.lineId,
              description: route.description,
              destination: route.destination,
            },
          ]
        : [];
    });
  }, [confidenceArrivals, routes]);

  const betterStopsByRoute = useMemo(() => {
    const result = new Map<string, BetterStopOption>();
    if (!selectedStop || !isUsableLocation(userLocation)) return result;
    for (const routeCode of selectedRouteCodes) {
      const detail = routeDetails.get(routeCode);
      const state = catchStates.get(routeCode);
      if (!detail || !state) continue;
      const baseline = representativeCatchOption(
        catchOptionsForStop(
          selectedStop,
          (arrivalData?.arrivals ?? []).filter(
            (arrival) => arrival.routeCode === routeCode,
          ),
          userLocation,
        ),
      );
      const stops = new Map(detail.stops.map((stop) => [stop.code, stop]));
      const alternatives = state.stopArrivals.flatMap(({ stopCode, arrivals }) => {
        const stop = stops.get(stopCode);
        return stop ? catchOptionsForStop(stop, arrivals, userLocation) : [];
      });
      const better = bestAlternateStop(baseline, alternatives);
      if (better) result.set(routeCode, better);
    }
    return result;
  }, [
    arrivalData?.arrivals,
    catchStates,
    routeDetails,
    selectedRouteCodes,
    selectedStop,
    userLocation,
  ]);
  const alternateVehicleKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const [routeCode, option] of betterStopsByRoute) {
      keys.add(`${routeCode}:${option.baseline.arrival.vehicleId}`);
    }
    return keys;
  }, [betterStopsByRoute]);

  const candidates = useMemo<CandidateArrival[]>(
    () =>
      timelineArrivals
        .filter((arrival) => arrival.confidence !== "unconfirmed")
        .map((arrival) => ({
          lineId: arrival.lineId,
          routeCode: arrival.routeCode,
          vehicleKey: arrival.vehicleKey,
          minutes: arrival.minutes,
          walkSeconds:
            selectedStop && isUsableLocation(userLocation)
              ? estimateWalk(userLocation, selectedStop).seconds
              : undefined,
        })),
    [selectedStop, timelineArrivals, userLocation],
  );

  const sendAlerts = useCallback(
    async (events: readonly AlertEvent[]) => {
      if (!selectedStopRef.current || events.length === 0) return;
      const stop = selectedStopRef.current;
      const zeroLines = events
        .filter((event) => event.kind === "zero")
        .map((event) => event.lineId);
      if (zeroLines.length > 0) {
        const lineNames = [...new Set(zeroLines)].map(formatTransitName);
        setUrgentMessage(
          `${lineNames.join(", ")} ${
            lineNames.length === 1 ? "is" : "are"
          } due now at ${formatTransitName(stop.name)}.`,
        );
      }
      const warningLines = events
        .filter((event) => event.kind === "one-minute")
        .map((event) => formatTransitName(event.lineId));
      if (warningLines.length > 0 && zeroLines.length === 0) {
        setStatus(`${warningLines.join(", ")} ${
          warningLines.length === 1 ? "is" : "are"
        } 1 min away.`);
      }
      const leaveLines = events
        .filter((event) => event.kind === "leave-now")
        .map((event) => formatTransitName(event.lineId));
      if (
        leaveLines.length > 0 &&
        zeroLines.length === 0 &&
        warningLines.length === 0
      ) {
        setUrgentMessage(`Leave now for ${[...new Set(leaveLines)].join(", ")}.`);
      }

      for (const event of events) {
        const line = formatTransitName(event.lineId);
        const dueNow = event.kind === "zero";
        const leaveNow = event.kind === "leave-now";
        const title = leaveNow
          ? `Leave now for ${line}`
          : dueNow
            ? `${line} is due now`
            : `${line} is 1 min away`;
        const body = `${formatTransitName(stop.name)} · ${
          leaveNow ? "walking-time alert" : dueNow ? "arrival alert" : "1-minute alert"
        }`;
        const options = {
          body,
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          tag: `line-${stop.code}-${event.lineId}-${event.vehicleKey}`,
          renotify: true,
          requireInteraction: dueNow || leaveNow,
          vibrate: dueNow || leaveNow
            ? [400, 140, 400, 140, 600]
            : [120],
        };

        try {
          if ("serviceWorker" in navigator) {
            const registration = await navigator.serviceWorker.ready;
            await registration.showNotification(title, options);
          } else {
            new Notification(title, options);
          }
        } catch {
          if (!dueNow && !leaveNow) setStatus(`${title}. ${body}`);
        }
      }

    },
    [],
  );

  const processSubscriptions = useCallback(
    (
      currentCandidates: readonly CandidateArrival[],
      now = new Date(),
    ) => {
      const evaluation = evaluateSubscriptions(
        subscriptionsRef.current,
        currentCandidates,
        now,
      );
      updateSubscriptions(evaluation.subscriptions);
      void sendAlerts(evaluation.events);
    },
    [sendAlerts, updateSubscriptions],
  );

  useEffect(() => {
    if (!arrivalData) return;
    processSubscriptions(candidates, new Date(arrivalData.observedAt));
    // One evaluation per OASA snapshot; subscription updates must not replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivalData?.observedAt]);

  useEffect(() => {
    const nextPredicted = subscriptions
      .flatMap((subscription) => [
        subscription.firedLeaveNow ? null : subscription.predictedLeaveAt,
        subscription.predictedZeroAt,
      ])
      .filter((value): value is string => Boolean(value))
      .sort()[0];
    if (!nextPredicted) return;
    const delay = Math.max(0, new Date(nextPredicted).getTime() - Date.now());
    const timeout = window.setTimeout(
      () => processSubscriptions([], new Date()),
      Math.min(delay, 2_147_000_000),
    );
    return () => window.clearTimeout(timeout);
  }, [processSubscriptions, subscriptions]);

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
      setError("Allow browser notifications to track a bus line.");
      return false;
    }
    return true;
  }

  async function toggleRoute(routeCode: string, lineId: string) {
    const isSelected = selectedRouteCodes.includes(routeCode);
    if (isSelected) {
      const remainingRoute = subscriptionsRef.current.find(
        (item) => item.routeCode && item.routeCode !== routeCode,
      )?.routeCode;
      updateSubscriptions((current) =>
        current.filter(
          (item) =>
            item.routeCode !== routeCode &&
            !(item.routeCode === null && item.lineId === lineId),
        ),
      );
      setFocusedRouteCode((current) =>
        current === routeCode ? remainingRoute ?? null : current,
      );
      setStatus(`Tracking is off for ${formatTransitName(lineId)} in this direction.`);
      return;
    }
    if (!(await ensureNotificationPermission())) return;
    let detail: RouteDetails | undefined = routeDetails.get(routeCode);
    if (!detail) {
      try {
        const response = await fetch(`/api/routes/${routeCode}`);
        if (response.ok) detail = (await response.json()) as RouteDetails;
      } catch {
        // Selection can still work when optional direction metadata is unavailable.
      }
    }
    if (
      detail &&
      selectedStop &&
      detail.stops.at(-1)?.code === selectedStop.code &&
      !detail.isCircular
    ) {
      setError("That bus finishes here, so there is no onward direction to track.");
      return;
    }
    updateSubscriptions((current) => [
      ...current.filter(
        (item) => !(item.routeCode === null && item.lineId === lineId),
      ),
      createSubscription(lineId, routeCode),
    ]);
    setFocusedRouteCode(routeCode);
    setStatus(`Tracking ${formatTransitName(lineId)} toward ${formatTransitName(
      detail?.destination ?? routes.find((route) => route.routeCode === routeCode)?.destination ?? "its destination",
    )}.`);
  }

  const locate = useCallback((force = false) => {
    if (locationDeniedRef.current && !force) return;
    const showProgress = force || coordinatesRef.current === null;
    if (showProgress) setIsLocating(true);
    if (force) setError(null);

    if (!navigator.geolocation) {
      if (force) setError("Location is not supported. Choose a stop on the map.");
      setIsLocating(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        applyPosition(position, true);
        const nextCoordinates = coordinatesRef.current;
        if (nextCoordinates) {
          setMapFocus(nextCoordinates);
          setStatus("Map centered on your location.");
        }
        if (showProgress) setIsLocating(false);
      },
      (locationError) => {
        if (locationError.code === 1) locationDeniedRef.current = true;
        if (showProgress) setIsLocating(false);
        if (force) {
          const messages: Record<number, string> = {
            1: "Location was denied. Choose a stop on the map.",
            2: "Your location is unavailable. Try again or use the map.",
            3: "Location timed out. Try again or use the map.",
          };
          setError(messages[locationError.code] ?? "Could not get your location.");
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: force ? 0 : 20_000,
        timeout: 10_000,
      },
    );
  }, [applyPosition]);

  useEffect(() => {
    if (!hydrated || !navigator.geolocation) return;

    let watchId: number | null = null;
    const stopWatching = () => {
      if (watchId === null) return;
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    };
    const startWatching = () => {
      if (watchId !== null || document.visibilityState !== "visible") return;
      watchId = navigator.geolocation.watchPosition(
        (position) => applyPosition(position),
        (locationError) => {
          if (locationError.code === 1) locationDeniedRef.current = true;
        },
        {
          enableHighAccuracy: false,
          maximumAge: 20_000,
          timeout: 10_000,
        },
      );
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") startWatching();
      else stopWatching();
    };

    startWatching();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      stopWatching();
    };
  }, [applyPosition, hydrated]);

  function chooseStop(stop: StopSummary) {
    setSearchQuery("");
    void loadStop(stop);
  }

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
    if (existing && !window.confirm(`Replace the existing "${existing.name}" favorite?`)) {
      return;
    }
    const now = new Date().toISOString();
    const favorite: Favorite = {
      id: existing?.id ?? crypto.randomUUID(),
      name,
      stop: stopReference(selectedStop),
      routes: subscriptions.map(({ lineId, routeCode }) => ({
        lineId,
        routeCode,
      })),
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

  async function enableFavorite(favorite: Favorite) {
    if (favorite.routes.length > 0 && !(await ensureNotificationPermission())) {
      return;
    }
    const requested = favorite.routes.map(({ lineId, routeCode }) =>
      createSubscription(lineId, routeCode),
    );
    const loaded = await loadStop(favorite.stop, requested);
    if (!loaded) return;
    if (loaded.validLineIds.length !== favorite.routes.length) {
      setStatus("Some saved lines no longer serve this stop, so we removed them.");
    }
    const enabledAt = new Date().toISOString();
    setFavorites((current) =>
      current.map((item) =>
        item.id === favorite.id ? { ...item, lastEnabledAt: enabledAt } : item,
      ),
    );
    setFavoritesOpen(false);
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
              routes: subscriptions.map(({ lineId, routeCode }) => ({
                lineId,
                routeCode,
              })),
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    );
    setStatus(`Updated "${favorite.name}".`);
  }

  function deleteFavorite(favorite: Favorite) {
    if (!window.confirm(`Delete "${favorite.name}"?`)) return;
    setFavorites((current) => current.filter((item) => item.id !== favorite.id));
  }

  function toggleFavoriteMenu(
    favoriteId: string,
    button: HTMLButtonElement,
  ) {
    if (favoriteMenu?.favoriteId === favoriteId) {
      setFavoriteMenu(null);
      return;
    }

    const rect = button.getBoundingClientRect();
    const menuWidth = 128;
    const menuHeight = 96;
    const viewportMargin = 8;
    const left = Math.min(
      window.innerWidth - menuWidth - viewportMargin,
      Math.max(viewportMargin, rect.right - menuWidth),
    );
    const top =
      rect.bottom + menuHeight + viewportMargin <= window.innerHeight
        ? rect.bottom + 4
        : Math.max(viewportMargin, rect.top - menuHeight - 4);
    setFavoriteMenu({ favoriteId, left, top });
  }

  function forgetEverything() {
    if (!window.confirm("Forget the saved stop, favorites, and tracked lines?")) {
      return;
    }
    stopLoadVersionRef.current += 1;
    stopRouteLoaderRef.current.abort();
    setIsLoadingStop(false);
    clearStoredState();
    selectedStopRef.current = null;
    setSelectedStop(null);
    setRoutes([]);
    setFocusedRouteCode(null);
    setOpenAlternate(null);
    updateSubscriptions([]);
    setFavorites([]);
    setFavoriteMenu(null);
    setPickerOpen(true);
    setFavoritesOpen(false);
    setStatus("Your saved data was cleared.");
  }

  const toastMessage =
    error ?? catalogError ?? arrivalError ?? urgentMessage ?? status;
  const toastIsError = Boolean(error || catalogError || arrivalError);
  const toastIsUrgent = Boolean(!toastIsError && urgentMessage);
  const canSaveFavorite = selectedStop !== null && selectedLineIds.length > 0;
  const hasNoArrivals =
    selectedStop !== null &&
    arrivalData !== null &&
    !arrivalsLoading &&
    !isLoadingStop &&
    timelineArrivals.length === 0;

  return (
    <main className="mx-auto flex h-dvh w-full max-w-2xl flex-col overflow-hidden px-4 pt-6 pb-4 sm:px-6 sm:pt-8">
      <header className="mb-5 flex items-start justify-between">
        <h1 className="flex items-center gap-2 text-xs font-bold tracking-[0.22em] text-signal uppercase">
          <Icon name="bus" className="size-5" />
          Athens Bus Tracker
        </h1>
        <button
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink/55 transition hover:text-signal"
          onClick={() => setFavoritesOpen(true)}
          type="button"
        >
          Favorites
          <Icon name="star" className="size-4 shrink-0 -translate-y-px" />
        </button>
      </header>

      <section
        aria-label={selectedStop ? undefined : "Choose a stop"}
        className={
          selectedStop
            ? `selected-stop-disclosure ${
                pickerOpen ? "selected-stop-disclosure-open" : ""
              }`
            : "flex min-h-0 flex-1 flex-col overflow-hidden"
        }
      >
        {selectedStop && (
          <button
            aria-controls={`stop-picker-${selectedStop.code}`}
            aria-expanded={pickerOpen}
            className={`selected-stop-row ${
              hasNoArrivals ? "selected-stop-row-no-arrivals" : ""
            }`}
            onClick={() => setPickerOpen((current) => !current)}
            type="button"
          >
            <span aria-hidden="true" className="selected-stop-marker" />
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate font-bold">
                {formatTransitName(selectedStop.name)}
              </span>
              {(selectedStop.street || coordinates) && (
                <span className="mt-0.5 block truncate text-xs text-ink/50">
                  {selectedStop.street
                    ? formatTransitName(selectedStop.street)
                    : distanceLabel(selectedStop.distanceMeters)}
                </span>
              )}
            </span>
            <span className="small-action shrink-0">
              {pickerOpen ? "Track" : "Change"}
            </span>
          </button>
        )}
        <div
          aria-hidden={selectedStop ? !pickerOpen : undefined}
          className={
            selectedStop
              ? "selected-stop-panel"
              : "flex min-h-0 flex-1 flex-col"
          }
          id={selectedStop ? `stop-picker-${selectedStop.code}` : "stop-picker"}
          inert={selectedStop ? !pickerOpen : false}
          key="stop-picker-panel"
        >
          <div
            className={
              selectedStop
                ? "selected-stop-panel-inner"
                : "flex min-h-0 flex-1 flex-col"
            }
          >
            <div className="stop-picker-shell">
              <StopMap
                catalogError={catalogError}
                catalogLoading={catalogLoading}
                center={coordinates}
                directionHeadingDegrees={
                  focusedRouteCode && selectedStop
                    ? routeDetails
                        .get(focusedRouteCode)
                        ?.stops.find(
                          (stop) => stop.code === selectedStop.code,
                        )?.headingDegrees ?? null
                    : null
                }
                focusCenter={mapFocus}
                isLocating={isLocating}
                onRefreshLocation={() => locate(true)}
                onSelectStop={chooseStop}
                selectedStop={selectedStop}
                suggestedStop={openAlternate?.stop ?? null}
                stops={catalogStops}
              />
              <StopCombobox
                hasLocation={coordinates !== null}
                isLoading={
                  catalogLoading ||
                  isSearching ||
                  (searchQuery.trim().length < 2 &&
                    isLocating &&
                    nearbyStops.length === 0)
                }
                onQueryChange={setSearchQuery}
                onSelect={chooseStop}
                options={
                  searchQuery.trim().length >= 2
                    ? searchResult.stops
                    : nearbyStops
                }
                query={searchQuery}
                resultTotal={
                  searchQuery.trim().length >= 2 ? searchResult.total : null
                }
              />
            </div>
          </div>
        </div>
      </section>

      {selectedStop && !pickerOpen ? (
        <ArrivalTimeline
          alternateVehicleKeys={alternateVehicleKeys}
          arrivals={timelineArrivals}
          isLoading={arrivalsLoading || isLoadingStop || arrivalData === null}
          observedAt={arrivalData?.observedAt ?? null}
          onOpenAlternate={(routeCode) =>
            setOpenAlternate(betterStopsByRoute.get(routeCode) ?? null)
          }
          onToggleRoute={(routeCode, lineId) =>
            void toggleRoute(routeCode, lineId)
          }
          selectedRouteCodes={selectedRouteCodes}
        />
      ) : null}

      <AlternateStopDialog
        currentStop={selectedStop}
        onClose={() => setOpenAlternate(null)}
        onConfirm={(option) => {
          setOpenAlternate(null);
          void loadStop(option.stop, subscriptionsRef.current);
        }}
        option={openAlternate}
      />

      <dialog
        aria-labelledby="favorites-heading"
        className="favorites-dialog"
        onCancel={(event) => {
          event.preventDefault();
          setFavoritesOpen(false);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) setFavoritesOpen(false);
        }}
        onClose={() => {
          setFavoriteMenu(null);
          setFavoritesOpen(false);
        }}
        ref={favoritesDialogRef}
      >
        <div className="favorites-sheet">
          <div className="flex items-center justify-between gap-3 border-b border-ink/15 pb-4">
            <div className="flex items-center gap-2">
              <Icon name="star" className="size-5 text-signal" />
              <h2 className="section-label text-signal" id="favorites-heading">
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
              <label className="section-label" htmlFor="favorite-name">
                Save current setup
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  className="field min-w-0 flex-1"
                  id="favorite-name"
                  maxLength={40}
                  onChange={(event) => setFavoriteName(event.target.value)}
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
                {formatTransitName(selectedStop?.name ?? "")} ·{" "}
                {selectedLineIds.map(formatTransitName).join(" · ")}
              </p>
            </form>
          )}

          <div className="favorites-list max-h-[55vh] overflow-y-auto">
            {favorites.length === 0 ? (
              <div className="py-8 text-center text-sm text-ink/45">
                <p>No favorites saved yet.</p>
                <p className="mt-1">Select a stop and at least one bus line to save one.</p>
              </div>
            ) : (
              <div className="divide-y divide-ink/10">
                {sortFavorites(favorites).map((favorite) => (
                  <div className="flex items-center gap-3 py-4" key={favorite.id}>
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => void enableFavorite(favorite)}
                      type="button"
                    >
                      <span className="block truncate font-semibold">{favorite.name}</span>
                      <span className="block truncate text-xs text-ink/55">
                        {formatTransitName(favorite.stop.name)} ·{" "}
                        {favorite.routes
                          .map(({ lineId }) => formatTransitName(lineId))
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
                    <button
                      aria-expanded={favoriteMenu?.favoriteId === favorite.id}
                      aria-haspopup="menu"
                      aria-label={`Actions for ${favorite.name}`}
                      className="small-action"
                      data-favorite-menu-trigger
                      onClick={(event) =>
                        toggleFavoriteMenu(favorite.id, event.currentTarget)
                      }
                      type="button"
                    >
                      •••
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        {favoriteMenu && (() => {
          const favorite = favorites.find(
            (item) => item.id === favoriteMenu.favoriteId,
          );
          if (!favorite) return null;
          return (
            <div
              className="favorite-menu-popup w-32 border border-ink/15 bg-paper p-1 shadow-lg"
              data-favorite-menu-popup
              role="menu"
              style={{ left: favoriteMenu.left, top: favoriteMenu.top }}
            >
              <button
                className="menu-action"
                onClick={() => {
                  renameFavorite(favorite);
                  setFavoriteMenu(null);
                }}
                role="menuitem"
                type="button"
              >
                Rename
              </button>
              <button
                className="menu-action"
                onClick={() => {
                  updateFavorite(favorite);
                  setFavoriteMenu(null);
                }}
                role="menuitem"
                type="button"
              >
                Update
              </button>
              <button
                className="menu-action text-red-700"
                onClick={() => {
                  deleteFavorite(favorite);
                  setFavoriteMenu(null);
                }}
                role="menuitem"
                type="button"
              >
                Delete
              </button>
            </div>
          );
        })()}
      </dialog>

      {toastMessage && (
        <Toast
          isError={toastIsError}
          isUrgent={toastIsUrgent}
          key={toastMessage}
          message={toastMessage}
          onDismiss={() => {
            setError(null);
            setUrgentMessage(null);
            setStatus(null);
          }}
        />
      )}

      <footer className="mt-auto grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 pt-3 text-xs text-ink/45">
        <p>Live data by OASA</p>
        <ThemeSwitch />
        <button
          className="small-action justify-self-end underline"
          onClick={forgetEverything}
          type="button"
        >
          Forget saved data
        </button>
      </footer>
    </main>
  );
}
