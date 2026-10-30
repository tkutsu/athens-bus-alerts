import { NextResponse } from "next/server";
import { apiError, isStopCode, oasaErrorResponse } from "@/lib/api";
import { getArrivalsForStop } from "@/lib/oasa/client";
import { normalizeArrivals } from "@/lib/oasa/normalize";

interface RouteContext {
  params: Promise<{ stopCode: string }>;
}

// Kept below the fastest (20s, near-arrival) poll interval so a lone client
// never re-reads its own stale snapshot.
const ARRIVALS_TTL_SECONDS = 15;
const MAX_PENDING_REQUESTS = 100;
const pendingRequests = new Map<string, Promise<Response>>();

// The Worker is the origin on Cloudflare, so shared caching must go through
// the Cache API explicitly; plain Node (next dev/start) has no `caches.default`
// and only coalesces requests that overlap within this instance.
function edgeCache(): Cache | undefined {
  return (globalThis as { caches?: { default?: Cache } }).caches?.default;
}

/** Fetches and caches one snapshot without sharing a consumable response body. */
async function loadSnapshot(stopCode: string, cacheKey: Request, cache: Cache | undefined) {
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

/** Returns cached arrivals and shares concurrent misses within this Worker instance. */
export async function GET(request: Request, context: RouteContext) {
  const { stopCode } = await context.params;
  if (!isStopCode(stopCode)) {
    return apiError(400, "INVALID_INPUT", "Choose a valid stop.");
  }

  const cache = edgeCache();
  const cacheKey = new Request(new URL(`/api/stops/${stopCode}/arrivals`, request.url));
  const cached = await cache?.match(cacheKey);
  if (cached) return cached;

  let pending = pendingRequests.get(cacheKey.url);
  if (!pending) {
    pending = loadSnapshot(stopCode, cacheKey, cache);
    if (pendingRequests.size < MAX_PENDING_REQUESTS) pendingRequests.set(cacheKey.url, pending);
  }
  try {
    return (await pending).clone();
  } finally {
    if (pendingRequests.get(cacheKey.url) === pending) pendingRequests.delete(cacheKey.url);
  }
}
