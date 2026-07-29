import type { z } from "zod";
import {
  arrivalsResponseSchema,
  closestStopsResponseSchema,
  routesResponseSchema,
  stopDetailsResponseSchema,
} from "@/lib/oasa/schemas";

const OASA_API_URL = "https://telematics.oasa.gr/api/";
const TIMEOUT_MS = 8_000;

type OasaAction =
  | "getClosestStops"
  | "getStopNameAndXY"
  | "webRoutesForStop"
  | "getStopArrivals";

export class OasaRequestError extends Error {
  constructor(
    public readonly kind: "timeout" | "unavailable" | "invalid-response",
    message: string,
  ) {
    super(message);
    this.name = "OasaRequestError";
  }
}

async function requestOasa<T>(
  action: OasaAction,
  schema: z.ZodType<T>,
  parameters: string[],
): Promise<T> {
  const url = new URL(OASA_API_URL);
  url.searchParams.set("act", action);
  parameters.forEach((parameter, index) => {
    url.searchParams.set(`p${index + 1}`, parameter);
  });

  let response: Response;

  try {
    response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new OasaRequestError("timeout", "OASA timed out");
    }

    throw new OasaRequestError("unavailable", "OASA is unavailable");
  }

  if (!response.ok) {
    throw new OasaRequestError(
      "unavailable",
      `OASA returned HTTP ${response.status}`,
    );
  }

  let value: unknown;

  try {
    value = JSON.parse(await response.text());
  } catch {
    throw new OasaRequestError(
      "invalid-response",
      "OASA returned invalid JSON",
    );
  }

  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    throw new OasaRequestError(
      "invalid-response",
      "OASA returned an unexpected response",
    );
  }

  return parsed.data;
}

/** Gets OASA stop candidates near a coordinate. */
export function getClosestStops(latitude: number, longitude: number) {
  return requestOasa(
    "getClosestStops",
    closestStopsResponseSchema,
    [String(latitude), String(longitude)],
  );
}

/** Gets one stop's name and position. */
export function getStopDetails(stopCode: string) {
  return requestOasa(
    "getStopNameAndXY",
    stopDetailsResponseSchema,
    [stopCode],
  );
}

/** Gets routes that serve one stop. */
export function getRoutesForStop(stopCode: string) {
  return requestOasa(
    "webRoutesForStop",
    routesResponseSchema,
    [stopCode],
  );
}

/** Gets live arrival estimates for one stop. */
export function getArrivalsForStop(stopCode: string) {
  return requestOasa(
    "getStopArrivals",
    arrivalsResponseSchema,
    [stopCode],
  );
}
