import { expect, test, type Page } from "@playwright/test";
import { createSubscription, STORAGE_KEY } from "../lib/storage";
import type { StoredState } from "../lib/types";

const STOP = { code: "400075", name: "FIRST STOP", latitude: 37.9445913, longitude: 23.6671421 };
const SECOND_STOP = { ...STOP, code: "400076", name: "SECOND STOP" };
const enabledLine = /Disable notifications for line 218/;
const disabledLine = /Enable notifications for line 218/;

/** Supplies deterministic transit, position, and notification interfaces. */
async function mockTracker(page: Page, minutes = 8, stored?: StoredState) {
  await page.addInitScript(({ stop, key, stored }) => {
    if (stored && !sessionStorage.getItem("seeded")) {
      localStorage.setItem(key, JSON.stringify(stored));
      sessionStorage.setItem("seeded", "yes");
    }
    const runtime = window as typeof window & {
      trackerNotifications: string[];
      emitTrackerPosition: () => void;
    };
    runtime.trackerNotifications = [];
    let watch: PositionCallback | null = null;
    runtime.emitTrackerPosition = () => watch?.({
      coords: { latitude: stop.latitude, longitude: stop.longitude, accuracy: 1 },
      timestamp: Date.now(),
    } as GeolocationPosition);
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
      watchPosition(success: PositionCallback) {
        watch = success;
        runtime.emitTrackerPosition();
        return 1;
      },
      clearWatch() { watch = null; },
    } });
    Object.defineProperty(window, "Notification", { configurable: true, value: class {
      static permission = "granted";
      static requestPermission = async () => "granted";
    } });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {
      register: async () => ({}),
      ready: Promise.resolve({ showNotification: async (title: string) => {
        runtime.trackerNotifications.push(title);
      } }),
    } });
  }, { stop: STOP, key: STORAGE_KEY, stored });
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
  await page.route("**/data/stops.json", (route) => route.fulfill({ json: { stops: [STOP, SECOND_STOP] } }));
  await page.route("**/api/stops/*", (route) => route.fulfill({ json: { routes: [
    { routeCode: "2810", lineId: "218", description: "Origin - Destination", destination: "Destination" },
  ] } }));
  let arrivalRequests = 0;
  await page.route("**/api/stops/*/arrivals", async (route) => {
    arrivalRequests++;
    await route.fulfill({ json: {
      arrivals: [{ routeCode: "2810", vehicleId: "a", minutes }],
      observedAt: new Date(await page.evaluate(() => Date.now())).toISOString(),
    } });
  });
  await page.route("**/api/routes/*", (route) => route.fulfill({ json: {
    routeCode: "2810", destination: "TERMA", isCircular: false, stops: [{ code: "499999" }],
  } }));
  return { arrivalRequests: () => arrivalRequests };
}

async function chooseStop(page: Page, name = "first stop") {
  await page.getByRole("combobox").fill(name);
  await page.getByRole("option", { name: new RegExp(name, "i") }).click();
  await expect(page.getByRole("button", { name: disabledLine })).toBeVisible();
}

async function readState(page: Page): Promise<StoredState> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
}

test("enabling a line immediately evaluates the displayed snapshot without another poll", async ({ page }) => {
  const mock = await mockTracker(page, 1);
  await page.goto("/");
  await chooseStop(page);
  await page.getByRole("button", { name: disabledLine }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { trackerNotifications: string[] }).trackerNotifications))
    .toContain("218 is 1 min away");
  expect((await readState(page)).subscriptions[0].trackedVehicleKey).toBe("2810:a");
  expect(mock.arrivalRequests()).toBe(1);
});

test("parallel enables create one subscription and one route-details request", async ({ page }) => {
  await mockTracker(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let requests = 0;
  await page.route("**/api/routes/*", async (route) => {
    requests++;
    await gate;
    await route.fulfill({ json: { destination: "TERMA", isCircular: false, stops: [] } });
  });
  await page.goto("/");
  await chooseStop(page);
  const button = page.getByRole("button", { name: disabledLine });
  await button.click();
  await button.click();
  release();
  await expect(page.getByRole("button", { name: enabledLine })).toBeVisible();
  expect(requests).toBe(1);
  expect((await readState(page)).subscriptions).toHaveLength(1);
});

for (const action of ["forget", "change stop"] as const) {
  test(`pending enables cannot restore tracking after ${action}`, async ({ page }) => {
    await mockTracker(page);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let requested = false;
    await page.route("**/api/routes/*", async (route) => {
      requested = true;
      await gate;
      await route.fulfill({ json: { destination: "TERMA", isCircular: false, stops: [] } }).catch(() => {});
    });
    await page.goto("/");
    await chooseStop(page);
    await page.getByRole("button", { name: disabledLine }).click();
    await expect.poll(() => requested).toBe(true);
    if (action === "forget") {
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Forget saved data" }).click();
    } else {
      await page.getByRole("button", { name: /first stop.*change/i }).click();
      await chooseStop(page, "second stop");
    }
    const settled = page.waitForResponse("**/api/routes/*").catch(() => null);
    release();
    await settled;
    await expect.poll(async () => (await readState(page)).subscriptions).toEqual([]);
    expect((await readState(page)).selectedStop?.code ?? null).toBe(action === "forget" ? null : SECOND_STOP.code);
  });
}

test("a failed restore preserves the saved stop across reloads", async ({ page }) => {
  await mockTracker(page, 8, { version: 5, selectedStop: STOP, subscriptions: [createSubscription("218", "2810")], favorites: [] });
  let requests = 0;
  await page.route("**/api/stops/*", (route) => {
    requests++;
    return route.fulfill({ status: 502, json: { error: { code: "OASA_UNAVAILABLE", message: "Unavailable" } } });
  });
  await page.goto("/");
  await expect(page.getByText("Couldn't load lines for first stop", { exact: true })).toBeVisible();
  expect((await readState(page)).selectedStop?.code).toBe(STOP.code);
  await page.reload();
  await expect(page.getByText("Couldn't load lines for first stop", { exact: true })).toBeVisible();
  expect(requests).toBe(2);
  await page.route("**/api/stops/400076", (route) => route.fulfill({ json: { routes: [
    { routeCode: "2810", lineId: "218", description: "Origin - Destination" },
  ] } }));
  await chooseStop(page, "second stop");
  expect((await readState(page)).subscriptions).toEqual([]);
});

test("fresh stationary positions keep walking predictions available", async ({ page }) => {
  await mockTracker(page, 8, { version: 5, selectedStop: STOP, subscriptions: [createSubscription("218", "2810")], favorites: [] });
  await page.clock.install();
  await page.goto("/");
  await expect(page.getByRole("button", { name: enabledLine })).toBeVisible();
  await expect.poll(async () => (await readState(page)).subscriptions[0].predictedLeaveAt).not.toBeNull();
  for (let index = 0; index < 5; index++) {
    await page.clock.runFor(30_000);
    await page.evaluate(() => (window as typeof window & { emitTrackerPosition: () => void }).emitTrackerPosition());
  }
  await expect.poll(async () => (await readState(page)).subscriptions[0].predictedLeaveAt).not.toBeNull();
});

test("storage write and removal failures leave tracking usable", async ({ page }) => {
  await mockTracker(page);
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException("denied", "QuotaExceededError"); };
    Storage.prototype.removeItem = () => { throw new DOMException("denied", "SecurityError"); };
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await chooseStop(page);
  await page.getByRole("button", { name: disabledLine }).click();
  await expect(page.getByRole("button", { name: enabledLine })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Forget saved data" }).click();
  await expect(page.getByRole("combobox")).toBeVisible();
  expect(errors).toEqual([]);
});
