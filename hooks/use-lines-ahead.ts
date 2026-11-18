"use client";

import { useEffect, useMemo, useState } from "react";
import { useStopCatalog } from "@/hooks/use-stop-catalog";
import { linesAhead, type RailLine } from "@/lib/metro";
import { loadRouteDetails } from "@/lib/route-details";
import type { RouteDetails } from "@/lib/types";

/** For each route shown at a stop, the metro and tram lines it reaches after it. */
export function useLinesAhead(
  stopCode: string | null,
  routeCodes: readonly string[],
): ReadonlyMap<string, RailLine[]> {
  const { stations } = useStopCatalog();
  const [routes, setRoutes] = useState<ReadonlyMap<string, RouteDetails>>(new Map());
  const routeKey = [...new Set(routeCodes)].sort().join(",");

  useEffect(() => {
    let active = true;
    for (const routeCode of routeKey ? routeKey.split(",") : []) {
      void loadRouteDetails(routeCode).then((route) => {
        if (!active || !route) return;
        setRoutes((current) =>
          current.has(routeCode) ? current : new Map(current).set(routeCode, route),
        );
      });
    }
    return () => {
      active = false;
    };
  }, [routeKey]);

  return useMemo(() => {
    if (!stopCode || stations.length === 0) return new Map();
    return new Map(
      [...routes].map(([routeCode, route]) => [
        routeCode,
        linesAhead(route, stopCode, stations),
      ]),
    );
  }, [routes, stopCode, stations]);
}
