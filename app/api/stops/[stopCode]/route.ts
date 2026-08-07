import { NextResponse } from "next/server";
import { apiError, isStopCode, oasaErrorResponse } from "@/lib/api";
import { getRoutesForStop } from "@/lib/oasa/client";
import { normalizeRoutes } from "@/lib/oasa/normalize";

interface RouteContext {
  params: Promise<{ stopCode: string }>;
}

/** Returns cacheable route metadata for a stop from the static catalogue. */
export async function GET(_request: Request, context: RouteContext) {
  const { stopCode } = await context.params;

  if (!isStopCode(stopCode)) {
    return apiError(400, "INVALID_INPUT", "Choose a valid stop.");
  }

  try {
    const upstreamRoutes = await getRoutesForStop(stopCode);
    return NextResponse.json(
      { routes: normalizeRoutes(upstreamRoutes ?? []) },
      {
        headers: {
          "Cache-Control":
            "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800",
        },
      },
    );
  } catch (error) {
    return oasaErrorResponse(error);
  }
}
