import { beforeEach, describe, expect, it } from "vitest";
import {
  clearStoredState,
  createSubscription,
  readStoredState,
  STORAGE_KEY,
  writeStoredState,
} from "@/lib/storage";
import { ARRIVAL_CACHE_KEY } from "@/lib/arrival-cache";

describe("stored state v5", () => {
  beforeEach(() => window.localStorage.clear());

  it("round-trips subscriptions and clears stored data", () => {
    const state = {
      version: 5 as const,
      selectedStop: { code: "400075", name: "HSAP N. FALHROY" },
      subscriptions: [createSubscription("218")],
      favorites: [
        {
          id: "favorite-1",
          name: "Home",
          stop: { code: "400075", name: "HSAP N. FALHROY" },
          routes: [
            { lineId: "218", routeCode: "2052" },
            { lineId: "500", routeCode: "2100" },
          ],
          createdAt: "2026-08-07T10:00:00.000Z",
          updatedAt: "2026-08-07T10:00:00.000Z",
          lastEnabledAt: null,
        },
      ],
    };

    writeStoredState(state);
    expect(readStoredState()).toEqual(state);

    window.localStorage.setItem(ARRIVAL_CACHE_KEY, "{}");
    clearStoredState();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(ARRIVAL_CACHE_KEY)).toBeNull();
  });

  it("keeps a favorite's rail line and drops one it doesn't know", () => {
    const favorite = (id: string, railLine: string) => ({
      id, name: id, stop: { code: "400075", name: "HSAP N. FALHROY" },
      routes: [{ lineId: "218", routeCode: "2052" }], railLine,
      createdAt: "2026-08-07T10:00:00.000Z", updatedAt: "2026-08-07T10:00:00.000Z",
      lastEnabledAt: null,
    });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 5, selectedStop: null, subscriptions: [],
      favorites: [favorite("Home", "M2"), favorite("Later", "M9")],
    }));

    const { favorites } = readStoredState();
    expect(favorites.map(({ name, railLine }) => [name, railLine])).toEqual([
      ["Home", "M2"],
      ["Later", undefined],
    ]);
  });
});
