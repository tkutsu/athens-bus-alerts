"use client";

import { useEffect, useState } from "react";
import type {
  CatalogStop,
  StopCatalogPayload,
} from "@/lib/stop-catalog";

const CATALOGUE_RETRY_MS = 5_000;

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

/** Exposes the browser-cached catalogue, retrying until it loads. */
export function useStopCatalog() {
  const [stops, setStops] = useState<CatalogStop[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let retry: number | undefined;

    const load = () => {
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
          retry = window.setTimeout(load, CATALOGUE_RETRY_MS);
        })
        .finally(() => {
          if (active) setIsLoading(false);
        });
    };
    load();

    return () => {
      active = false;
      window.clearTimeout(retry);
    };
  }, []);

  return { stops, error, isLoading };
}
