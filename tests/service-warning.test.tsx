import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArrivalWarning } from "@/components/service-warning";
import { ApiRequestError } from "@/lib/client-api";

describe("ArrivalWarning retry status", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-30T10:00:00Z"));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function warning(retryAt: number | null, isRetrying = false, isOffline = false) {
    return <ArrivalWarning
      error={new ApiRequestError("Unavailable", "OASA_UNAVAILABLE", 502)}
      isOffline={isOffline}
      isRetrying={isRetrying}
      retryAt={retryAt}
      observedAt={null}
      onDismiss={() => {}}
    />;
  }

  it("counts down to the retry and shows retrying when it is due", async () => {
    render(warning(Date.now() + 20_000));
    expect(screen.getByRole("alert")).toHaveTextContent("Retrying in 20s.");
    await act(async () => { await vi.advanceTimersByTimeAsync(19_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("Retrying in 1s.");
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("Retrying...");
  });

  it("shows retrying without a future deadline", () => {
    render(warning(null));
    expect(screen.getByRole("alert")).toHaveTextContent("Retrying...");
  });

  it("shows retrying for an active request even before its old deadline", () => {
    render(warning(Date.now() + 20_000, true));
    expect(screen.getByRole("alert")).toHaveTextContent("Retrying...");
  });

  it("explains that offline retries wait for connectivity", () => {
    render(warning(Date.now(), true, true));
    expect(screen.getByRole("alert")).toHaveTextContent("Updates will resume when you're back online.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Retrying...");
  });
});
