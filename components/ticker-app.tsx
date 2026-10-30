"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AlertEvent, CandidateArrival } from "@/lib/alerts";
import { isAbortError } from "@/lib/client-api";
import { formatDistance, haversineMeters } from "@/lib/distance";
import {
  clearStoredState,
  createSubscription,
  readStoredState,
  writeStoredState,
} from "@/lib/storage";
import { FavoritesDialog } from "@/components/favorites-dialog";
import { Icon } from "@/components/icon";
import { ThemeSwitch } from "@/components/theme-switch";
import { Toast } from "@/components/toast";
import { useDeviceLocation } from "@/hooks/use-device-location";
import { useLineAlerts } from "@/hooks/use-line-alerts";
import { StopRouteLoader } from "@/lib/stop-routes";
import { formatTransitName } from "@/lib/display";
import type {
  Coordinates,
  Favorite,
  LineSubscription,
  RouteDetails,
  ServingRoute,
  StopSummary,
} from "@/lib/types";
import { findClosestStops, searchStopNames } from "@/lib/stop-catalog";
import { useArrivalPolling } from "@/hooks/use-arrival-polling";
import { useStopCatalog } from "@/hooks/use-stop-catalog";
import { StopCombobox } from "@/components/stop-combobox";
import { StopMap } from "@/components/stop-map";
import { ArrivalWarning, ServiceWarning } from "@/components/service-warning";
import {
  ArrivalTimeline,
  type TimelineArrival,
} from "@/components/arrival-timeline";
import {
  updateVehicleConfidence,
  STALE_ARRIVAL_MS,
  type VehicleConfidenceRecord,
} from "@/lib/vehicle-confidence";
import { estimateWalkSeconds, isUsableLocation } from "@/lib/walking";

function stopReference(stop: StopSummary) {
  return { code: stop.code, name: stop.name };
}

export function TickerApp() {
  const [hydrated, setHydrated] = useState(false);
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
  const pendingEnablesRef = useRef(new Set<string>());
  const savedStopRef = useRef<Pick<StopSummary, "code" | "name"> | null>(null);
  const stopRouteLoaderRef = useRef(new StopRouteLoader());
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stopError, setStopError] = useState<{
    stop: Pick<StopSummary, "code" | "name"> & Partial<StopSummary>;
    subscriptions?: LineSubscription[];
    message: string;
  } | null>(null);
  const [directionWarning, setDirectionWarning] = useState<string | null>(null);
  const [dismissedArrivalWarning, setDismissedArrivalWarning] = useState<string | null>(null);
  const [urgentMessage, setUrgentMessage] = useState<string | null>(null);
  const [isLoadingStop, setIsLoadingStop] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const confidenceRecordsRef = useRef(
    new Map<string, VehicleConfidenceRecord>(),
  );
  const confidenceStopCodeRef = useRef<string | null>(null);

  const updateSubscriptions = useCallback(
    (next: LineSubscription[] | ((current: LineSubscription[]) => LineSubscription[])) => {
      const value = typeof next === "function" ? next(subscriptionsRef.current) : next;
      subscriptionsRef.current = value;
      setSubscriptionsState(value);
    },
    [],
  );

  const updateStopDistance = useCallback((nextCoordinates: Coordinates) => {
    setSelectedStop((currentStop) => {
      if (!currentStop) return currentStop;
      const nextStop = {
        ...currentStop,
        distanceMeters: haversineMeters(nextCoordinates, currentStop),
      };
      selectedStopRef.current = nextStop;
      return nextStop;
    });
  }, []);
  const { coordinates, coordinatesRef, userLocation, mapFocus, isLocating, locate } = useDeviceLocation({
    enabled: hydrated,
    onMove: updateStopDistance,
    onStatus: setStatus,
    onError: setError,
  });

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
    isOffline: arrivalsOffline,
    retryAt: arrivalsRetryAt,
  } = useArrivalPolling(
    selectedStop?.code ?? null,
    selectedRouteCodes,
    !pickerOpen,
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
        const previousStopCode = selectedStopRef.current?.code ?? savedStopRef.current?.code;
        const changingStop = previousStopCode !== undefined && previousStopCode !== stop.code;

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
        savedStopRef.current = stopReference(stop);
        setSelectedStop(stop);
        setRoutes(servingRoutes);
        setStopError(null);
        setDirectionWarning(null);
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
        setStopError({
          stop: requestedStop,
          subscriptions: requestedSubscriptions,
          message: loadError instanceof Error
            ? loadError.message
            : "Could not load that stop.",
        });
        return null;
      } finally {
        if (loadVersion === stopLoadVersionRef.current) {
          setIsLoadingStop(false);
        }
      }
    },
    [catalogStops, coordinatesRef, updateSubscriptions],
  );

  /* eslint-disable react-hooks/set-state-in-effect -- hydrate browser storage after SSR */
  useEffect(() => {
    if (hydrationStartedRef.current || catalogLoading) return;
    hydrationStartedRef.current = true;

    const stored = readStoredState();
    savedStopRef.current = stored.selectedStop;
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
      selectedStop: savedStopRef.current,
      subscriptions,
      favorites,
    });
  }, [favorites, hydrated, selectedStop, subscriptions]);

  const [confidenceSnapshot, setConfidenceSnapshot] = useState<{
    stopCode: string | null;
    arrivals: ReturnType<typeof updateVehicleConfidence>["arrivals"];
    observedAt: string;
  } | null>(null);
  const [confidenceClock, setConfidenceClock] = useState(() => Date.now());
  const arrivalsUnavailable = Boolean(
    arrivalError || arrivalsOffline ||
    (arrivalData && confidenceClock - Date.parse(arrivalData.observedAt) > STALE_ARRIVAL_MS),
  );
  const canProcessAlerts = !arrivalsUnavailable && arrivalData !== null &&
    confidenceSnapshot?.stopCode === selectedStop?.code &&
    confidenceSnapshot?.observedAt === arrivalData.observedAt;

  const hasArrivalData = arrivalData !== null;
  useEffect(() => {
    if (!hasArrivalData) return;
    const interval = window.setInterval(
      () => setConfidenceClock(Date.now()),
      30_000,
    );
    return () => window.clearInterval(interval);
  }, [hasArrivalData]);

  useEffect(() => {
    if (!arrivalData) return;
    // The macrotask deferral is load-bearing: the timeline must render the new
    // snapshot's observedAt against the previous arrivals before positions
    // move, or the ETA-correction animation classes never apply (covered by
    // the "accelerates and brakes" e2e test).
    const timeout = window.setTimeout(() => {
      const sameStop = confidenceStopCodeRef.current === selectedStop?.code;
      const update = updateVehicleConfidence(
        sameStop ? confidenceRecordsRef.current : new Map(),
        arrivalData.arrivals,
        arrivalData.observedAt,
        confidenceClock,
      );
      confidenceStopCodeRef.current = selectedStop?.code ?? null;
      confidenceRecordsRef.current = update.records;
      setConfidenceSnapshot({
        stopCode: selectedStop?.code ?? null,
        arrivals: update.arrivals,
        observedAt: arrivalData.observedAt,
      });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [arrivalData, confidenceClock, selectedStop?.code]);

  const timelineArrivals = useMemo<TimelineArrival[]>(() => {
    if (!hasArrivalData || confidenceSnapshot?.stopCode !== selectedStop?.code) return [];
    const routesByCode = new Map(
      routes.map((route) => [route.routeCode, route]),
    );
    return (confidenceSnapshot?.arrivals ?? []).flatMap((arrival) => {
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
  }, [hasArrivalData, confidenceSnapshot, routes, selectedStop?.code]);

  const candidates = useMemo<CandidateArrival[]>(() => {
    const walkSeconds =
      selectedStop && isUsableLocation(userLocation)
        ? estimateWalkSeconds(userLocation, selectedStop)
        : undefined;
    return timelineArrivals
      .filter((arrival) => arrival.confidence !== "unconfirmed")
      .map((arrival) => ({
        lineId: arrival.lineId,
        routeCode: arrival.routeCode,
        vehicleKey: arrival.vehicleKey,
        minutes: arrival.minutes,
        walkSeconds,
      }));
  }, [selectedStop, timelineArrivals, userLocation]);

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

  const alertSnapshot = useMemo(() => canProcessAlerts && selectedStop && confidenceSnapshot
    ? { stopCode: selectedStop.code, observedAt: confidenceSnapshot.observedAt, candidates }
    : null, [canProcessAlerts, selectedStop, confidenceSnapshot, candidates]);
  useLineAlerts({ snapshot: alertSnapshot, subscriptions, onChange: updateSubscriptions, onEvents: sendAlerts });

  /* eslint-disable react-hooks/set-state-in-effect -- invalidate predictions when the external arrivals service becomes unavailable */
  useEffect(() => {
    if (!arrivalsUnavailable) return;
    // Old predictions must not fire as catch-up alerts after an outage.
    updateSubscriptions((current) => current.map((subscription) => ({
      ...subscription,
      predictedLeaveAt: null,
      predictedZeroAt: null,
    })));
    setUrgentMessage(null);
  }, [arrivalsUnavailable, updateSubscriptions]);
  /* eslint-enable react-hooks/set-state-in-effect */

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
    const stop = selectedStopRef.current;
    if (!stop) return;
    const isSelected = selectedRouteCodes.includes(routeCode);
    if (isSelected) {
      updateSubscriptions((current) =>
        current.filter(
          (item) =>
            item.routeCode !== routeCode &&
            !(item.routeCode === null && item.lineId === lineId),
        ),
      );
      setStatus(`Tracking is off for ${formatTransitName(lineId)} in this direction.`);
      return;
    }
    const version = stopLoadVersionRef.current;
    const pendingKey = `${version}:${routeCode}`;
    if (pendingEnablesRef.current.has(pendingKey)) return;
    pendingEnablesRef.current.add(pendingKey);
    const isCurrent = () => stopLoadVersionRef.current === version &&
      selectedStopRef.current?.code === stop.code;
    try {
      if (!(await ensureNotificationPermission()) || !isCurrent()) return;
      let detail: RouteDetails | undefined;
      try {
        const response = await fetch(`/api/routes/${routeCode}`, {
          signal: AbortSignal.timeout(12_000),
        });
        if (response.ok) detail = (await response.json()) as RouteDetails;
      } catch {
        // Selection can still work when optional direction metadata is unavailable.
      }
      if (!isCurrent()) return;
      setDirectionWarning(detail
        ? null
        : `Line ${formatTransitName(lineId)}: direction details are unavailable.`);
      if (
        detail &&
        detail.stops.at(-1)?.code === stop.code &&
        !detail.isCircular
      ) {
        setError("That bus finishes here, so there is no onward direction to track.");
        return;
      }
      updateSubscriptions((current) => [
        ...current.filter(
          (item) => item.routeCode !== routeCode &&
            !(item.routeCode === null && item.lineId === lineId),
        ),
        createSubscription(lineId, routeCode),
      ]);
      setStatus(`Tracking ${formatTransitName(lineId)} toward ${formatTransitName(
        detail?.destination ?? routes.find((route) => route.routeCode === routeCode)?.destination ?? "its destination",
      )}.`);
    } finally {
      pendingEnablesRef.current.delete(pendingKey);
    }
  }

  function chooseStop(stop: StopSummary) {
    setSearchQuery("");
    void loadStop(stop);
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

  function forgetEverything() {
    if (!window.confirm("Forget the saved stop, favorites, and tracked lines?")) {
      return;
    }
    stopLoadVersionRef.current += 1;
    stopRouteLoaderRef.current.abort();
    setIsLoadingStop(false);
    clearStoredState();
    selectedStopRef.current = null;
    savedStopRef.current = null;
    setSelectedStop(null);
    setRoutes([]);
    setStopError(null);
    setDirectionWarning(null);
    updateSubscriptions([]);
    setFavorites([]);
    setPickerOpen(true);
    setFavoritesOpen(false);
    setStatus("Your saved data was cleared.");
  }

  const toastMessage =
    error ?? catalogError ?? urgentMessage ?? status;
  const toastIsError = Boolean(error || catalogError);
  const toastIsUrgent = Boolean(!toastIsError && urgentMessage);
  const arrivalWarningKey = `${selectedStop?.code}:${arrivalsRetryAt ?? arrivalData?.observedAt ?? "initial"}`;
  const showArrivalWarning = selectedStop && !pickerOpen && arrivalsUnavailable && dismissedArrivalWarning !== arrivalWarningKey;
  const hasNoArrivals =
    selectedStop !== null &&
    arrivalData !== null &&
    !arrivalsLoading &&
    !isLoadingStop &&
    !arrivalsUnavailable &&
    timelineArrivals.length === 0;

  return (
    <main className="mx-auto flex h-svh w-full max-w-2xl flex-col overflow-hidden px-4 pt-6 pb-4 sm:h-dvh sm:px-6 sm:pt-8">
      <header className="mb-5 flex items-start justify-between">
        <h1 className="flex items-center gap-2 text-xs font-bold tracking-[0.22em] text-signal uppercase">
          <Icon name="bus" className="size-5" />
          My Pocket Bus: Athens
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

      {showArrivalWarning && (
        <ArrivalWarning
          error={arrivalError}
          isOffline={arrivalsOffline}
          isRetrying={arrivalsLoading}
          retryAt={arrivalsRetryAt}
          observedAt={arrivalData?.observedAt ?? null}
          onDismiss={() => setDismissedArrivalWarning(arrivalWarningKey)}
        />
      )}

      {stopError && (
        <ServiceWarning
          title={`Couldn't load lines for ${formatTransitName(stopError.stop.name)}`}
          message={stopError.message}
        >
          <button
            className="font-semibold underline"
            disabled={isLoadingStop}
            onClick={() => void loadStop(stopError.stop, stopError.subscriptions)}
            type="button"
          >
            {isLoadingStop ? "Retrying..." : "Retry"}
          </button>
        </ServiceWarning>
      )}

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
            } ${arrivalsUnavailable ? "selected-stop-row-arrivals-unavailable" : ""}`}
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
                    : `${formatDistance(selectedStop.distanceMeters)} away`}
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
                focusCenter={mapFocus}
                isLocating={isLocating}
                onRefreshLocation={() => locate(true)}
                onSelectStop={chooseStop}
                selectedStop={selectedStop}
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

      {selectedStop && !pickerOpen && directionWarning && (
        <p className="mb-3 text-xs text-ink/70" role="status">{directionWarning}</p>
      )}
      {selectedStop && !pickerOpen ? (
        <ArrivalTimeline
          arrivals={timelineArrivals}
          isLoading={arrivalsLoading || isLoadingStop || arrivalData === null}
          isUnavailable={arrivalsUnavailable}
          observedAt={arrivalData?.observedAt ?? null}
          onToggleRoute={(routeCode, lineId) =>
            void toggleRoute(routeCode, lineId)
          }
          selectedRouteCodes={selectedRouteCodes}
        />
      ) : null}

      <FavoritesDialog
        open={favoritesOpen}
        onClose={() => setFavoritesOpen(false)}
        favorites={favorites}
        setFavorites={setFavorites}
        selectedStop={selectedStop}
        subscriptions={subscriptions}
        onEnable={enableFavorite}
        setStatus={setStatus}
        setError={setError}
      />

      {toastMessage && !showArrivalWarning && (
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
