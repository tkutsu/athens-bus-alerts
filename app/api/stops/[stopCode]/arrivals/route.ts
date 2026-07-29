import { NextResponse } from "next/server";
import { apiError, isStopCode, oasaErrorResponse } from "@/lib/api";
import { getArrivalsForStop } from "@/lib/oasa/client";
import { normalizeArrivals } from "@/lib/oasa/normalize";

interface RouteContext {
  params: Promise<{ stopCode: string }>;
}

/** Returns live arrivals with route and vehicle IDs. */
export async function GET(_request: Request, context: RouteContext) {
  const { stopCode } = await context.params;

  if (!isStopCode(stopCode)) {
    return apiError(400, "INVALID_INPUT", "Enter a valid numeric stop code.");
  }

  try {
    const upstreamArrivals = await getArrivalsForStop(stopCode);

    return NextResponse.json({
      arrivals: normalizeArrivals(upstreamArrivals ?? []),
      observedAt: new Date().toISOString(),
    });
  } catch (error) {
    return oasaErrorResponse(error);
  }
}
