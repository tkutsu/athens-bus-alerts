import { NextResponse } from "next/server";
import { OasaRequestError } from "@/lib/oasa/client";
import type { ApiErrorPayload } from "@/lib/types";

export function isStopCode(value: string): boolean {
  return /^\d{1,8}$/.test(value);
}

export const isRouteCode = isStopCode;

// The Worker is the origin on Cloudflare, so shared caching must go through
// the Cache API explicitly; plain Node (next dev/start) has no `caches.default`.
export function edgeCache(): Cache | undefined {
  return (globalThis as { caches?: { default?: Cache } }).caches?.default;
}

/** Serves a successful response from the Worker cache for as long as its `s-maxage` allows. */
export async function cachedAtEdge(
  request: Request,
  load: () => Promise<Response>,
): Promise<Response> {
  const cache = edgeCache();
  // Keyed by path alone so query strings cannot force upstream requests.
  const cacheKey = new Request(new URL(new URL(request.url).pathname, request.url));
  const cached = await cache?.match(cacheKey);
  if (cached) return cached;

  const response = await load();
  if (response.ok) await cache?.put(cacheKey, response.clone());
  return response;
}

export function apiError(
  status: number,
  code: ApiErrorPayload["error"]["code"],
  message: string,
  retryable = false,
) {
  return NextResponse.json<ApiErrorPayload>(
    { error: { code, message, retryable } },
    { status },
  );
}

// OASA silently drops connections from outside Greece, which looks exactly
// like an outage. Cloudflare tells us where the visitor is, and the Worker
// runs near them, so a non-Greek visitor explains the silence.
function isOutsideGreece(request: Request): boolean {
  const country = request.headers.get("cf-ipcountry");
  return country !== null && country !== "XX" && country !== "GR";
}

export function oasaErrorResponse(error: unknown, request: Request) {
  if (error instanceof OasaRequestError) {
    if (error.kind !== "invalid-response" && isOutsideGreece(request)) {
      return apiError(
        502,
        "OASA_GEO_BLOCKED",
        "OASA only answers requests from Greece.",
      );
    }

    if (error.kind === "timeout") {
      return apiError(
        504,
        "OASA_UNAVAILABLE",
        "OASA took too long to respond.",
        true,
      );
    }

    if (error.kind === "invalid-response") {
      return apiError(
        502,
        "OASA_INVALID_RESPONSE",
        "OASA returned data in an unexpected format.",
        true,
      );
    }

    return apiError(
      502,
      "OASA_UNAVAILABLE",
      "OASA is temporarily unavailable.",
      true,
    );
  }

  return apiError(
    500,
    "OASA_UNAVAILABLE",
    "The request could not be completed.",
    true,
  );
}
