"use client";

import { useEffect, useRef, useState } from "react";
import { apiErrorMessage } from "@/lib/client-api";
import type { RouteDetails } from "@/lib/types";

/** Loads and caches direction metadata for active routes in the current tab. */
export function useRouteDetails(routeCodes: readonly string[]) {
  const cacheRef = useRef(new Map<string, RouteDetails>());
  const [details, setDetails] = useState<ReadonlyMap<string, RouteDetails>>(
    () => new Map(),
  );
  const [error, setError] = useState<string | null>(null);
  const key = [...new Set(routeCodes)].sort().join(",");

  useEffect(() => {
    const requested = key ? key.split(",") : [];
    const missing = requested.filter((code) => !cacheRef.current.has(code));
    if (missing.length === 0) return;
    const controller = new AbortController();

    void Promise.all(
      missing.map(async (routeCode) => {
        const response = await fetch(`/api/routes/${routeCode}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(
            await apiErrorMessage(response, "Could not load route direction."),
          );
        }
        return (await response.json()) as RouteDetails;
      }),
    )
      .then((loaded) => {
        for (const route of loaded) cacheRef.current.set(route.routeCode, route);
        setDetails(new Map(cacheRef.current));
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load route direction.",
        );
      });

    return () => controller.abort();
  }, [key]);

  return { details, error };
}
