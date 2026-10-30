"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { haversineMeters } from "@/lib/distance";
import type { Coordinates, UserLocation } from "@/lib/types";

const LOCATION_MIN_MOVEMENT_METERS = 10;

interface DeviceLocationOptions {
  enabled: boolean;
  onMove: (coordinates: Coordinates) => void;
  onStatus: (message: string) => void;
  onError: (message: string | null) => void;
}

/** Keeps device readings fresh while throttling map movement and watching only visible pages. */
export function useDeviceLocation({
  enabled,
  onMove,
  onStatus: setStatus,
  onError: setError,
}: DeviceLocationOptions) {
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [mapFocus, setMapFocus] = useState<Coordinates | null>(null);
  const coordinatesRef = useRef<Coordinates | null>(null);
  const locationDeniedRef = useRef(false);
  const [isLocating, setIsLocating] = useState(false);

  /** Applies a fresh device position and keeps selected-stop distance in sync. */
  const applyPosition = useCallback(
    (position: GeolocationPosition, force = false): boolean => {
      const nextCoordinates = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      const previousCoordinates = coordinatesRef.current;
      locationDeniedRef.current = false;
      setUserLocation({
        ...nextCoordinates,
        accuracyMeters: position.coords.accuracy,
        observedAt: new Date(position.timestamp).toISOString(),
      });
      if (
        !force &&
        previousCoordinates &&
        haversineMeters(previousCoordinates, nextCoordinates) <
          LOCATION_MIN_MOVEMENT_METERS
      ) {
        return false;
      }

      coordinatesRef.current = nextCoordinates;
      setCoordinates(nextCoordinates);
      if (!previousCoordinates) setMapFocus(nextCoordinates);
      onMove(nextCoordinates);
      return true;
    },
    [onMove],
  );

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
  }, [applyPosition, setError, setStatus]);

  useEffect(() => {
    if (!enabled || !navigator.geolocation) return;

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
  }, [applyPosition, enabled]);

  return { coordinates, coordinatesRef, userLocation, mapFocus, isLocating, locate };
}
