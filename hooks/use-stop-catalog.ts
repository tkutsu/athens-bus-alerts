"use client";

import { useEffect, useState } from "react";
import type {
  CatalogStop,
  StopCatalogPayload,
} from "@/lib/stop-catalog";

let catalogueRequest: Promise<CatalogStop[]> | null = null;

/** Loads the static stop catalogue once and shares it across client components. */
function loadCatalogue(): Promise<CatalogStop[]> {
  if (!catalogueRequest) {
    catalogueRequest = fetch("/data/stops.json", { cache: "force-cache" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Could not load the stop catalogue.");
        }
        const payload = (await response.json()) as StopCatalogPayload;
        if (!Array.isArray(payload.stops)) {
          throw new Error("The stop catalogue is invalid.");
        }
        return payload.stops;
      })
      .catch((error) => {
        catalogueRequest = null;
        throw error;
      });
  }

  return catalogueRequest;
}

/** Exposes the browser-cached catalogue with loading and error state. */
export function useStopCatalog() {
  const [stops, setStops] = useState<CatalogStop[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    void loadCatalogue()
      .then((catalogue) => {
        if (!active) return;
        setStops(catalogue);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load the stop catalogue.",
        );
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return { stops, error, isLoading };
}
