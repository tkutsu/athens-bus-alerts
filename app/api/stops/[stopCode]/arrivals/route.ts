import { NextResponse } from "next/server";
import { apiError, isStopCode, oasaErrorResponse } from "@/lib/api";
import { getArrivalsForStop } from "@/lib/oasa/client";
import { normalizeArrivals } from "@/lib/oasa/normalize";

interface RouteContext {
  params: Promise<{ stopCode: string }>;
}

// Kept below the fastest (20s, near-arrival) poll interval so a lone client
// never re-reads its own stale snapshot; concurrent viewers still coalesce.
const ARRIVALS_TTL_SECONDS = 15;

// The Worker is the origin on Cloudflare, so shared caching must go through
// the Cache API explicitly; plain Node (next dev/start) has no `caches.default`
// and falls through to a fresh OASA call per request.
function edgeCache(): Cache | undefined {
  return (globalThis as { caches?: { default?: Cache } }).caches?.default;
}

/** Returns live arrivals with route and vehicle IDs, shared across viewers. */
export async function GET(request: Request, context: RouteContext) {
  const { stopCode } = await context.params;

  if (!isStopCode(stopCode)) {
    return apiError(400, "INVALID_INPUT", "Choose a valid stop.");
  }

  const cache = edgeCache();
  const cacheKey = new Request(
    new URL(`/api/stops/${stopCode}/arrivals`, request.url),
  );
  const cached = await cache?.match(cacheKey);
  if (cached) return cached;

  try {
    const upstreamArrivals = await getArrivalsForStop(stopCode);
    const response = NextResponse.json(
      {
        arrivals: normalizeArrivals(upstreamArrivals ?? []),
        observedAt: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": `public, max-age=0, s-maxage=${ARRIVALS_TTL_SECONDS}`,
        },
      },
    );
    // Only successful snapshots are cached; errors always retry upstream.
    await cache?.put(cacheKey, response.clone());
    return response;
  } catch (error) {
    return oasaErrorResponse(error);
  }
}
