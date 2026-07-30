import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  arrivalPollInterval,
  useArrivalPolling,
} from "@/hooks/use-arrival-polling";

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
  it("uses the earliest selected route to choose 60, 30, or 20 seconds", () => {
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
    ).toBe(20_000);
    expect(arrivalPollInterval(arrivals, ["missing"])).toBe(30_000);
  });
});

describe("useArrivalPolling", () => {
  beforeEach(() => {
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

  it("coalesces simultaneous resume events into one request", async () => {
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

    expect(fetchMock).toHaveBeenCalledTimes(2);
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
      await vi.advanceTimersByTimeAsync(19_999);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
