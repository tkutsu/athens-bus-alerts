import { NextResponse } from "next/server";
import { apiError, isStopCode, oasaErrorResponse } from "@/lib/api";
import { getRoutesForStop, getStopDetails } from "@/lib/oasa/client";
import {
  normalizeRoutes,
  normalizeStopDetails,
} from "@/lib/oasa/normalize";

interface RouteContext {
  params: Promise<{ stopCode: string }>;
}

/** Returns stop details and serving routes. */
export async function GET(_request: Request, context: RouteContext) {
  const { stopCode } = await context.params;

  if (!isStopCode(stopCode)) {
    return apiError(400, "INVALID_INPUT", "Choose a valid stop.");
  }

  try {
    const [details, upstreamRoutes] = await Promise.all([
      getStopDetails(stopCode),
      getRoutesForStop(stopCode),
    ]);
    const stop = details?.[0];

    if (!stop) {
      return apiError(404, "NOT_FOUND", "That OASA stop was not found.");
    }

    const routes = normalizeRoutes(upstreamRoutes ?? []);

    return NextResponse.json({
      stop: { ...normalizeStopDetails(stop), distanceMeters: 0 },
      ...routes,
    });
  } catch (error) {
    return oasaErrorResponse(error);
  }
}
