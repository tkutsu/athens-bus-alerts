import { NextResponse } from "next/server";
import { apiError, oasaErrorResponse, parseCoordinates } from "@/lib/api";
import { getClosestStops } from "@/lib/oasa/client";
import { normalizeClosestStops } from "@/lib/oasa/normalize";

/** Gets and distance-sorts the ten nearest OASA stops. */
export async function GET(request: Request) {
  const coordinates = parseCoordinates(new URL(request.url).searchParams);

  if (!coordinates) {
    return apiError(
      400,
      "INVALID_INPUT",
      "Choose a location within the OASA service area.",
    );
  }

  try {
    const upstreamStops = await getClosestStops(
      coordinates.latitude,
      coordinates.longitude,
    );
    const stops = normalizeClosestStops(
      upstreamStops ?? [],
      coordinates,
      10,
    );

    if (stops.length === 0) {
      return apiError(404, "NOT_FOUND", "No nearby OASA stops were found.");
    }

    return NextResponse.json({ stops });
  } catch (error) {
    return oasaErrorResponse(error);
  }
}
