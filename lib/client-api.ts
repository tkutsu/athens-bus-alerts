import type { ApiErrorPayload } from "@/lib/types";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly code: ApiErrorPayload["error"]["code"] | null,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/** Preserves upstream error details without attributing internal failures to OASA. */
export async function apiResponseError(
  response: Response,
  fallback: string,
): Promise<ApiRequestError> {
  const payload = (await response.json().catch(() => null)) as
    | ApiErrorPayload
    | null;
  return new ApiRequestError(
    payload?.error?.message ?? fallback,
    response.status === 500 ? null : (payload?.error?.code ?? null),
    response.status,
  );
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
