import { NextResponse } from "next/server";
import { OasaRequestError } from "@/lib/oasa/client";
import type { ApiErrorPayload } from "@/lib/types";

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
