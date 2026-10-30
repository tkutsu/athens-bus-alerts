import { useState } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLineAlerts } from "@/hooks/use-line-alerts";
import { createSubscription } from "@/lib/storage";

const snapshot = {
  stopCode: "400075",
  observedAt: "2026-08-07T10:00:00.000Z",
  candidates: [{ lineId: "218", routeCode: "2810", vehicleKey: "2810:a", minutes: 1 }],
};

describe("line alert lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(snapshot.observedAt));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("initializes a fresh favorite even when its selected routes and snapshot are unchanged", () => {
    const onEvents = vi.fn();
    const { result } = renderHook(() => {
      const [subscriptions, setSubscriptions] = useState([createSubscription("218", "2810")]);
      useLineAlerts({ snapshot, subscriptions, onChange: setSubscriptions, onEvents });
      return { subscriptions, reset: () => setSubscriptions([createSubscription("218", "2810")]) };
    });
    expect(result.current.subscriptions[0].trackedVehicleKey).toBe("2810:a");
    act(() => result.current.reset());
    expect(result.current.subscriptions[0].trackedVehicleKey).toBe("2810:a");
    expect(onEvents).toHaveBeenCalledTimes(2);
    expect(onEvents.mock.calls.every(([events]) => events[0].kind === "one-minute")).toBe(true);
  });

  it("rebuilds cleared predictions when the same fresh snapshot becomes available again", () => {
    const onEvents = vi.fn();
    const { result, rerender } = renderHook(({ available }) => {
      const [subscriptions, setSubscriptions] = useState([createSubscription("218", "2810")]);
      useLineAlerts({ snapshot: available ? snapshot : null, subscriptions, onChange: setSubscriptions, onEvents });
      return {
        subscriptions,
        invalidate: () => setSubscriptions((current) => current.map((subscription) => ({
          ...subscription, predictedZeroAt: null, predictedLeaveAt: null,
        }))),
      };
    }, { initialProps: { available: true } });
    rerender({ available: false });
    act(() => result.current.invalidate());
    expect(result.current.subscriptions[0].predictedZeroAt).toBeNull();
    rerender({ available: true });
    expect(result.current.subscriptions[0].predictedZeroAt).toBe("2026-08-07T10:01:00.000Z");
    expect(onEvents.mock.calls.flatMap(([events]) => events)).toHaveLength(1);
  });
});
