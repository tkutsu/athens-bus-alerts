import { NextResponse } from "next/server";
import { OasaRequestError } from "@/lib/oasa/client";
import type { ApiErrorPayload, Coordinates } from "@/lib/types";

const ATTICA_BOUNDS = {
  minLatitude: 37.5,
  maxLatitude: 38.5,
  minLongitude: 22.7,
  maxLongitude: 24.5,
};

export function parseCoordinates(
  searchParams: URLSearchParams,
): Coordinates | null {
  const latitude = Number(searchParams.get("lat"));
  const longitude = Number(searchParams.get("lng"));

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < ATTICA_BOUNDS.minLatitude ||
    latitude > ATTICA_BOUNDS.maxLatitude ||
    longitude < ATTICA_BOUNDS.minLongitude ||
    longitude > ATTICA_BOUNDS.maxLongitude
  ) {
    return null;
  }

  return { latitude, longitude };
}

export function isStopCode(value: string): boolean {
  return /^\d{1,8}$/.test(value);
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

export function oasaErrorResponse(error: unknown) {
  if (error instanceof OasaRequestError) {
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
