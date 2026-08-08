"use client";

import { useEffect, useRef, useState } from "react";
import type {
  LayerGroup,
  Map as LeafletMap,
  Marker,
} from "leaflet";
import {
  findStopsInBounds,
  type CatalogStop,
} from "@/lib/stop-catalog";
import { formatTransitName } from "@/lib/display";
import type { Coordinates, StopSummary } from "@/lib/types";

interface StopMapProps {
  catalogError: string | null;
  catalogLoading: boolean;
  center: Coordinates | null;
  focusCenter: Coordinates | null;
  isLocating: boolean;
  selectedStop: StopSummary | null;
  onRefreshLocation: () => void;
  onSelectStop: (stop: StopSummary) => void;
  stops: readonly CatalogStop[];
}

const ATHENS_CENTER: [number, number] = [37.9838, 23.7275];
// Includes every stop in the current catalogue with a small edge buffer.
export const OASA_MAP_BOUNDS: [[number, number], [number, number]] = [
  [37.7, 23.3],
  [38.35, 24.06],
];
const USER_LOCATION_PIN_HTML = `
  <svg aria-hidden="true" width="28" height="36" viewBox="0 0 28 36">
    <path d="M14 1.5C7.4 1.5 2 6.9 2 13.5 2 22.1 14 34 14 34s12-11.9 12-20.5C26 6.9 20.6 1.5 14 1.5Z" fill="#e5562f" stroke="#fff" stroke-width="2.5" stroke-linejoin="round" />
    <circle cx="14" cy="13.5" r="4.5" fill="#fff" />
  </svg>
`;

/** Draws the location pin used in the map legend. */
function LocationPinIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-3"
      suppressHydrationWarning
      viewBox="0 0 28 36"
    >
      <path
        d="M14 1.5C7.4 1.5 2 6.9 2 13.5 2 22.1 14 34 14 34s12-11.9 12-20.5C26 6.9 20.6 1.5 14 1.5Z"
        fill="#e5562f"
        stroke="#fff"
        strokeLinejoin="round"
        strokeWidth="2.5"
      />
      <circle cx="14" cy="13.5" fill="#fff" r="4.5" />
    </svg>
  );
}

/** Renders the Leaflet stop picker. */
export function StopMap({
  catalogError,
  catalogLoading,
  center,
  focusCenter,
  isLocating,
  selectedStop,
  onRefreshLocation,
  onSelectStop,
  stops,
}: StopMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<LayerGroup | null>(null);
  const userMarkerRef = useRef<Marker | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const selectStopRef = useRef(onSelectStop);
  const stopsRef = useRef(stops);
  const updateVisibleStopsRef = useRef<(() => void) | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [visibleStops, setVisibleStops] = useState<StopSummary[]>([]);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    selectStopRef.current = onSelectStop;
  }, [onSelectStop]);

  useEffect(() => {
    stopsRef.current = stops;
    const frame = requestAnimationFrame(() =>
      updateVisibleStopsRef.current?.(),
    );
    return () => cancelAnimationFrame(frame);
  }, [stops]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let cancelled = false;

    /** Creates the map and filters the in-memory catalogue on movement. */
    const initialize = async () => {
      const L = await import("leaflet");
      if (cancelled || !containerRef.current) return;

      leafletRef.current = L;
      const initialCenter: [number, number] = center
        ? [center.latitude, center.longitude]
        : ATHENS_CENTER;
      const map = L.map(containerRef.current, {
        center: initialCenter,
        zoom: 16,
        minZoom: 11,
        maxZoom: 19,
        maxBounds: OASA_MAP_BOUNDS,
        maxBoundsViscosity: 1,
        zoomControl: true,
      });

      // Use an unobtrusive text attribution instead of Leaflet's flag logo.
      map.attributionControl.setPrefix(
        '<a href="https://leafletjs.com">Leaflet</a>',
      );
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        bounds: OASA_MAP_BOUNDS,
        maxZoom: 19,
      }).addTo(map);

      markersRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setMapReady(true);

      const updateVisibleStops = () => {
        const bounds = map.getBounds();
        const result = findStopsInBounds(stopsRef.current, {
          north: bounds.getNorth(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          west: bounds.getWest(),
        });
        setVisibleStops(result.stops);
        setTruncated(result.truncated);
      };

      updateVisibleStopsRef.current = updateVisibleStops;
      map.on("moveend", updateVisibleStops);
      updateVisibleStops();

      const resizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(() => {
          if (cancelled) return;
          map.invalidateSize({ animate: false, pan: false });
          updateVisibleStops();
        });
      });
      resizeObserver.observe(containerRef.current);

      return () => resizeObserver.disconnect();
    };

    let disconnectResizeObserver: (() => void) | undefined;
    void initialize().then((disconnect) => {
      if (cancelled) {
        disconnect?.();
        return;
      }
      disconnectResizeObserver = disconnect;
    });

    return () => {
      cancelled = true;
      disconnectResizeObserver?.();
      userMarkerRef.current?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
      markersRef.current = null;
      userMarkerRef.current = null;
      updateVisibleStopsRef.current = null;
    };
    // The map instance is deliberately created only once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const L = leafletRef.current;
    const markers = markersRef.current;
    if (!L || !markers) return;

    markers.clearLayers();

    for (const stop of visibleStops) {
      const isSelected = stop.code === selectedStop?.code;

      // Use the original blue stops while a larger orange center identifies selection.
      const marker = L.circleMarker([stop.latitude, stop.longitude], {
        radius: isSelected ? 12 : 8,
        color: "#ffffff",
        opacity: 1,
        weight: isSelected ? 3.5 : 2,
        fillColor: isSelected ? "#e5562f" : "#2563eb",
        fillOpacity: 0.95,
      });

      marker
        .bindTooltip(formatTransitName(stop.name), {
          direction: "top",
          offset: [0, -4],
        })
        .on("click", () => selectStopRef.current(stop))
        .addTo(markers);
    }
    userMarkerRef.current?.setZIndexOffset(1000);
  }, [selectedStop?.code, visibleStops]);

  /** Updates the device location marker. */
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !mapReady || !map) return;

    if (!center) {
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      return;
    }

    const position: [number, number] = [
      center.latitude,
      center.longitude,
    ];
    if (userMarkerRef.current) {
      userMarkerRef.current.setLatLng(position);
      return;
    }

    const icon = L.divIcon({
      className: "",
      html: USER_LOCATION_PIN_HTML,
      iconAnchor: [14, 34],
      iconSize: [28, 36],
      tooltipAnchor: [0, -34],
    });
    const marker = L.marker(position, {
      icon,
      keyboard: false,
      zIndexOffset: 1000,
    });
    marker
      .bindTooltip("Your position", { direction: "top" })
      .addTo(map);
    userMarkerRef.current = marker;
    map.setView(position, 17);
  }, [center, mapReady]);

  /** Recenters only after an explicit location refresh. */
  useEffect(() => {
    if (!focusCenter || !mapRef.current) return;
    mapRef.current.panTo([
      focusCenter.latitude,
      focusCenter.longitude,
    ]);
  }, [focusCenter]);

  useEffect(() => {
    if (!selectedStop || !mapRef.current) return;
    mapRef.current.panTo([
      selectedStop.latitude,
      selectedStop.longitude,
    ]);
  }, [selectedStop]);

  return (
    <div className="stop-map-shell relative z-0 mt-4 flex min-h-0 flex-1 overflow-hidden border border-ink/20 bg-white/40">
      <div
        aria-label="Map of OASA bus stops"
        className="min-h-0 w-full flex-1"
        ref={containerRef}
      />
      <button
        aria-label="Refresh and center on your location"
        className="absolute right-2 bottom-8 z-[500] flex size-10 items-center justify-center border border-ink/20 bg-paper/95 text-signal shadow transition hover:bg-paper disabled:text-ink/35"
        disabled={isLocating}
        onClick={onRefreshLocation}
        title={
          isLocating
            ? "Refreshing your location"
            : "Refresh and center on your location"
        }
        type="button"
      >
        <svg
          aria-hidden="true"
          className={`size-5 ${isLocating ? "animate-pulse" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
          <circle cx="12" cy="12" r="8" />
        </svg>
      </button>
      {center && (
        <div className="pointer-events-none absolute top-2 right-2 z-[500] flex items-center gap-1.5 bg-paper/95 px-2 py-1 text-xs shadow">
          <LocationPinIcon />
          Your position
        </div>
      )}
      <div className="pointer-events-none absolute top-2 left-12 z-[500] flex gap-2">
        {catalogLoading && (
          <span className="bg-paper/95 px-2 py-1 text-xs shadow">
            Loading stops...
          </span>
        )}
        {truncated && (
          <span className="bg-paper/95 px-2 py-1 text-xs shadow">
            Zoom in for every stop
          </span>
        )}
        {catalogError && (
          <span className="bg-red-50 px-2 py-1 text-xs text-red-800 shadow">
            {catalogError}
          </span>
        )}
      </div>
    </div>
  );
}
