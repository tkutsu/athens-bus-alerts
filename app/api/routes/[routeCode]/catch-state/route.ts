import { NextResponse } from "next/server";
import { apiError, isRouteCode, isStopCode } from "@/lib/api";
import { getArrivalsForStop, getBusLocations } from "@/lib/oasa/client";
import { normalizeArrivals, normalizeBusLocations } from "@/lib/oasa/normalize";

interface RouteContext {
  params: Promise<{ routeCode: string }>;
}

/** Returns route-filtered alternate arrivals plus optional hidden telemetry. */
export async function GET(request: Request, context: RouteContext) {
  const { routeCode } = await context.params;
  if (!isRouteCode(routeCode)) {
    return apiError(400, "INVALID_INPUT", "Choose a valid route.");
  }

  const rawStops = new URL(request.url).searchParams.get("stops") ?? "";
  const stopCodes = [...new Set(rawStops.split(",").filter(Boolean))];
  if (stopCodes.length > 3 || stopCodes.some((code) => !isStopCode(code))) {
    return apiError(
      400,
      "INVALID_INPUT",
      "Choose at most three valid alternate stops.",
    );
  }

  const [telemetryResult, ...arrivalResults] = await Promise.allSettled([
    getBusLocations(routeCode),
    ...stopCodes.map((stopCode) => getArrivalsForStop(stopCode)),
  ]);
  const telemetryAvailable = telemetryResult.status === "fulfilled";
  const vehicles = telemetryAvailable
    ? normalizeBusLocations(telemetryResult.value ?? []).filter(
        (vehicle) => vehicle.routeCode === routeCode,
      )
    : [];
  const unavailableStopCodes: string[] = [];
  const stopArrivals = stopCodes.flatMap((stopCode, index) => {
    const result = arrivalResults[index];
    if (!result || result.status === "rejected") {
      unavailableStopCodes.push(stopCode);
      return [];
    }
    return [{
      stopCode,
      arrivals: normalizeArrivals(result.value ?? []).filter(
        (arrival) => arrival.routeCode === routeCode,
      ),
    }];
  });

  if (!telemetryAvailable && stopArrivals.length === 0) {
    return apiError(
      502,
      "OASA_UNAVAILABLE",
      "OASA is temporarily unavailable.",
      true,
    );
  }

  return NextResponse.json(
    {
      observedAt: new Date().toISOString(),
      telemetryAvailable,
      unavailableStopCodes,
      stopArrivals,
      vehicles,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
