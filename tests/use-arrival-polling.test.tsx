import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  arrivalPollInterval,
  useArrivalPolling,
} from "@/hooks/use-arrival-polling";
import { ARRIVAL_CACHE_KEY } from "@/lib/arrival-cache";

function arrivalsResponse(minutes: number): Response {
  return new Response(
    JSON.stringify({
      arrivals: [
        { routeCode: "2810", vehicleId: "bus-1", minutes },
        { routeCode: "9990", vehicleId: "bus-2", minutes: 1 },
      ],
      observedAt: new Date().toISOString(),
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}

function errorResponse(): Response {
  return new Response(
    JSON.stringify({ error: { message: "OASA is unavailable" } }),
    {
      status: 502,
      headers: { "Content-Type": "application/json" },
    },
  );
}

describe("arrivalPollInterval", () => {
  it("uses selected routes to choose 20, 30, or 60 seconds", () => {
    const arrivals = [
      { routeCode: "2810", vehicleId: "selected", minutes: 12 },
      { routeCode: "9990", vehicleId: "other", minutes: 1 },
    ];

    expect(arrivalPollInterval(arrivals, ["2810"])).toBe(60_000);
    expect(
      arrivalPollInterval(
        [{ ...arrivals[0], minutes: 10 }],
        ["2810"],
      ),
    ).toBe(30_000);
    expect(
      arrivalPollInterval(
        [{ ...arrivals[0], minutes: 3 }],
        ["2810"],
      ),
    ).toBe(30_000);
    expect(
      arrivalPollInterval(
        [{ ...arrivals[0], minutes: 2 }],
        ["2810"],
      ),
    ).toBe(30_000);
    expect(
      arrivalPollInterval(
        [{ ...arrivals[0], minutes: 1 }],
        ["2810"],
      ),
    ).toBe(20_000);
    expect(arrivalPollInterval(arrivals, ["missing"])).toBe(60_000);
    expect(arrivalPollInterval(arrivals, [])).toBe(60_000);
  });
});

describe("useArrivalPolling", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T10:00:00.000Z"));
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps the existing timer across resume events", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockImplementation(() =>
      Promise.resolve(arrivalsResponse(8)),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useArrivalPolling("400075", ["2810"]));
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(24_999);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not query or reschedule when selected routes change", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockImplementation(() =>
      Promise.resolve(arrivalsResponse(8)),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = renderHook(
      ({ routes }) => useArrivalPolling("400075", routes),
      { initialProps: { routes: [] as string[] } },
    );
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender({ routes: ["2810"] });
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_999);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("restores a cached snapshot and absolute nextPollAt timestamp", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockImplementation(() =>
      Promise.resolve(arrivalsResponse(8)),
    );
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem(
      ARRIVAL_CACHE_KEY,
      JSON.stringify({
        version: 1,
        stopCode: "400075",
        data: {
          arrivals: [
            { routeCode: "2810", vehicleId: "cached", minutes: 9 },
          ],
          observedAt: new Date().toISOString(),
        },
        nextPollAt: new Date(Date.now() + 30_000).toISOString(),
        pollIntervalMs: 30_000,
      }),
    );

    const { result } = renderHook(() =>
      useArrivalPolling("400075", ["2810"]),
    );
    await act(async () => {});
    expect(result.current.data?.arrivals[0].vehicleId).toBe("cached");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      JSON.parse(window.localStorage.getItem(ARRIVAL_CACHE_KEY) ?? "null")
        .nextPollAt,
    ).toBe("2026-07-29T10:00:30.000Z");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_999);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries every 40 seconds after errors and resets after success", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(errorResponse())
      .mockResolvedValueOnce(errorResponse())
      .mockImplementation(() => Promise.resolve(arrivalsResponse(2)));
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useArrivalPolling("400075", ["2810"]));
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(39_999);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(40_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_999);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
