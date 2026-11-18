import type { RouteDetails } from "@/lib/types";

const requests = new Map<string, Promise<RouteDetails | null>>();

/**
 * One request per route per tab, shared by line tracking and the metro chips.
 * Resolves to null when details are unavailable, and forgets a failure so the
 * next caller tries again.
 */
export function loadRouteDetails(routeCode: string): Promise<RouteDetails | null> {
  let request = requests.get(routeCode);
  if (!request) {
    request = fetch(`/api/routes/${routeCode}`, {
      signal: AbortSignal.timeout(12_000),
    })
      .then((response) =>
        response.ok ? (response.json() as Promise<RouteDetails>) : null,
      )
      .catch(() => null)
      .then((route) => {
        if (!route) requests.delete(routeCode);
        return route;
      });
    requests.set(routeCode, request);
  }
  return request;
}
