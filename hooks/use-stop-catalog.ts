"use client";

import { useEffect, useState } from "react";
import type { RailStation } from "@/lib/metro";
import type {
  CatalogStop,
  StopCatalogPayload,
} from "@/lib/stop-catalog";

const CATALOGUE_RETRY_MS = 5_000;

interface Catalogue {
  stops: CatalogStop[];
  stations: RailStation[];
}

const EMPTY_CATALOGUE: Catalogue = { stops: [], stations: [] };

let catalogueRequest: Promise<Catalogue> | null = null;

/** Loads the static stop catalogue once and shares it across client components. */
function loadCatalogue(): Promise<Catalogue> {
  if (!catalogueRequest) {
    // Follows the file's caching headers rather than any cached copy forever,
    // so a re-synced catalogue reaches browsers that hold an older one.
    catalogueRequest = fetch("/data/stops.json")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Could not load the stop catalogue.");
        }
        const payload = (await response.json()) as StopCatalogPayload;
        if (!Array.isArray(payload.stops)) {
          throw new Error("The stop catalogue is invalid.");
        }
        return {
          stops: payload.stops,
          stations: Array.isArray(payload.stations) ? payload.stations : [],
        };
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
  const [catalogue, setCatalogue] = useState<Catalogue>(EMPTY_CATALOGUE);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let retry: number | undefined;

    const load = () => {
      void loadCatalogue()
        .then((loaded) => {
          if (!active) return;
          setCatalogue(loaded);
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

  return { ...catalogue, error, isLoading };
}
