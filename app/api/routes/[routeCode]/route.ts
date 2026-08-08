import { NextResponse } from "next/server";
import { apiError, isRouteCode, oasaErrorResponse } from "@/lib/api";
import { getRouteDetails } from "@/lib/oasa/client";
import { normalizeRouteDetails } from "@/lib/oasa/normalize";

interface RouteContext {
  params: Promise<{ routeCode: string }>;
}

/** Returns cacheable ordered stops and geometry for one route direction. */
export async function GET(_request: Request, context: RouteContext) {
  const { routeCode } = await context.params;
  if (!isRouteCode(routeCode)) {
    return apiError(400, "INVALID_INPUT", "Choose a valid route.");
  }

  try {
    const details = normalizeRouteDetails(
      routeCode,
      await getRouteDetails(routeCode),
    );
    if (details.stops.length === 0) {
      return apiError(
        502,
        "OASA_INVALID_RESPONSE",
        "OASA returned no valid stops for that route.",
        true,
      );
    }
    return NextResponse.json(details, {
      headers: {
        "Cache-Control":
          "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch (error) {
    return oasaErrorResponse(error);
  }
}
