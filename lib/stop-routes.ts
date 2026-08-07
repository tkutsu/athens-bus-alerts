import { apiErrorMessage } from "@/lib/client-api";
import type { ServingRoute } from "@/lib/types";

interface StopRoutesPayload {
  routes: ServingRoute[];
}

/** Shares same-stop requests, aborts superseded ones, and caches routes per tab. */
export class StopRouteLoader {
  private readonly cache = new Map<string, ServingRoute[]>();
  private pending: {
    code: string;
    controller: AbortController;
    promise: Promise<ServingRoute[]>;
  } | null = null;

  async load(stopCode: string): Promise<ServingRoute[]> {
    const cached = this.cache.get(stopCode);
    if (cached) return cached;

    if (this.pending && this.pending.code !== stopCode) this.abort();
    if (!this.pending) {
      const controller = new AbortController();
      const promise = fetch(`/api/stops/${stopCode}`, {
        signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok) {
          throw new Error(
            await apiErrorMessage(
              response,
              "The request could not be completed.",
            ),
          );
        }
        const payload = (await response.json()) as StopRoutesPayload;
        return payload.routes;
      });
      this.pending = { code: stopCode, controller, promise };
    }

    const request = this.pending;
    try {
      const routes = await request.promise;
      this.cache.set(stopCode, routes);
      return routes;
    } finally {
      if (this.pending?.promise === request.promise) this.pending = null;
    }
  }

  abort(): void {
    this.pending?.controller.abort();
    this.pending = null;
  }
}
