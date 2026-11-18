"use client";

import { useEffect, useMemo, useState } from "react";
import { useSelectedLine } from "@/hooks/use-selected-line";
import { useStopCatalog } from "@/hooks/use-stop-catalog";
import { stopsToLine, type RailLine } from "@/lib/metro";
import { loadRouteDetails } from "@/lib/route-details";
import type { RouteDetails } from "@/lib/types";

export interface RailConnection {
  line: RailLine;
  stops: number;
}

/**
 * Finds each bus route's first connection to the rider's line. At a stop
 * already by the line there's nothing to count, so no route gets one.
 */
export function useRailConnections(
  stopCode: string | null,
  routeCodes: readonly string[],
): ReadonlyMap<string, RailConnection> {
  const line = useSelectedLine();
  const { stations } = useStopCatalog();
  const [routes, setRoutes] = useState<ReadonlyMap<string, RouteDetails>>(new Map());
  const routeKey = [...new Set(routeCodes)].sort().join(",");

  useEffect(() => {
    if (!line || !stopCode || stations.length === 0) return;
    let active = true;
    for (const routeCode of routeKey ? routeKey.split(",") : []) {
      void loadRouteDetails(routeCode).then((route) => {
        if (!active || !route) return;
        setRoutes((current) =>
          current.has(routeCode) ? current : new Map(current).set(routeCode, route),
        );
      });
    }
    return () => { active = false; };
  }, [routeKey, line, stopCode, stations.length]);

  return useMemo(() => {
    const connections = new Map<string, RailConnection>();
    if (!line || !stopCode) return connections;
    for (const [routeCode, route] of routes) {
      const stops = stopsToLine(route, stopCode, line, stations);
      if (stops) connections.set(routeCode, { line, stops });
    }
    return connections;
  }, [routes, stopCode, line, stations]);
}
