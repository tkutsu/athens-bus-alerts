import type { ApiErrorPayload } from "@/lib/types";

/** Reads the API error envelope while preserving a caller-specific fallback. */
export async function apiErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  const payload = (await response.json().catch(() => null)) as
    | ApiErrorPayload
    | null;
  return payload?.error.message ?? fallback;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
