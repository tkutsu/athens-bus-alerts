import type { LineSubscription, RecentVehicle } from "@/lib/types";

export interface CandidateArrival {
  lineId: string;
  routeCode?: string;
  vehicleKey: string;
  minutes: number;
  walkSeconds?: number;
}

export interface AlertEvent {
  kind: "leave-now" | "one-minute" | "zero";
  lineId: string;
  vehicleKey: string;
  minutes: number;
}

export interface SubscriptionEvaluation {
  subscriptions: LineSubscription[];
  events: AlertEvent[];
}

export const RECENT_VEHICLE_TTL_MS = 15 * 60_000;
export const MAX_RECENT_VEHICLES = 20;
export const STALE_PREDICTION_GRACE_MS = 2 * 60_000;

function predictedZeroAt(minutes: number, now: Date): string {
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

function predictedLeaveAt(
  arrival: CandidateArrival,
  now: Date,
): string | null {
  if (arrival.walkSeconds === undefined) return null;
  return new Date(
    now.getTime() +
      Math.max(0, arrival.minutes * 60 - arrival.walkSeconds - 90) * 1_000,
  ).toISOString();
}

function pruneRecentVehicles(
  recentVehicles: readonly RecentVehicle[],
  now: Date,
): RecentVehicle[] {
  return recentVehicles
    .filter(
      (vehicle) =>
        now.getTime() - new Date(vehicle.completedAt).getTime() <
        RECENT_VEHICLE_TTL_MS,
    )
    .slice(-MAX_RECENT_VEHICLES);
}

function beginTracking(
  subscription: LineSubscription,
  arrival: CandidateArrival | undefined,
  now: Date,
  preserveWarning = false,
): LineSubscription {
  if (!arrival) {
    return {
      ...subscription,
      trackedVehicleKey: null,
      firedLeaveNow: false,
      firedOneMinute: false,
      predictedLeaveAt: null,
      predictedZeroAt: null,
      lastObservedMinutes: null,
    };
  }

  return {
    ...subscription,
    trackedVehicleKey: arrival.vehicleKey,
    firedLeaveNow: preserveWarning && subscription.firedLeaveNow,
    firedOneMinute: preserveWarning && subscription.firedOneMinute,
    predictedLeaveAt: predictedLeaveAt(arrival, now),
    predictedZeroAt: predictedZeroAt(arrival.minutes, now),
    lastObservedMinutes: arrival.minutes,
  };
}

function completeTrackedVehicle(
  subscription: LineSubscription,
  candidates: readonly CandidateArrival[],
  now: Date,
): LineSubscription {
  const completedKey = subscription.trackedVehicleKey;
  const recentVehicles = completedKey
    ? [
        ...subscription.recentVehicles,
        { key: completedKey, completedAt: now.toISOString() },
      ].slice(-MAX_RECENT_VEHICLES)
    : subscription.recentVehicles;
  const recentKeys = new Set(recentVehicles.map((vehicle) => vehicle.key));
  const next = candidates.find(
    (candidate) => !recentKeys.has(candidate.vehicleKey),
  );

  return beginTracking(
    { ...subscription, recentVehicles },
    next,
    now,
  );
}

/** Advances every selected line from its nearest bus to the next one. */
export function evaluateSubscriptions(
  subscriptions: readonly LineSubscription[],
  arrivals: readonly CandidateArrival[],
  now = new Date(),
): SubscriptionEvaluation {
  const events: AlertEvent[] = [];

  const nextSubscriptions = subscriptions.map((original) => {
    let subscription = {
      ...original,
      recentVehicles: pruneRecentVehicles(original.recentVehicles, now),
    };
    const recentKeys = new Set(
      subscription.recentVehicles.map((vehicle) => vehicle.key),
    );
    const candidates = arrivals
      .filter(
        (arrival) =>
          arrival.lineId === subscription.lineId &&
          (!subscription.routeCode ||
            arrival.routeCode === subscription.routeCode) &&
          !recentKeys.has(arrival.vehicleKey),
      )
      .sort((a, b) => a.minutes - b.minutes);

    if (!subscription.trackedVehicleKey) {
      const preserveWarning = subscription.lastObservedMinutes !== null;
      subscription = beginTracking(
        subscription,
        candidates[0],
        now,
        preserveWarning,
      );
    }

    if (!subscription.trackedVehicleKey) return subscription;
    const trackedVehicleKey = subscription.trackedVehicleKey;

    const tracked = candidates.find(
      (arrival) => arrival.vehicleKey === trackedVehicleKey,
    );

    if (!tracked) {
      const leaveAt = subscription.predictedLeaveAt
        ? new Date(subscription.predictedLeaveAt).getTime()
        : null;
      if (
        leaveAt !== null &&
        leaveAt <= now.getTime() &&
        !subscription.firedLeaveNow
      ) {
        events.push({
          kind: "leave-now",
          lineId: subscription.lineId,
          vehicleKey: trackedVehicleKey,
          minutes: subscription.lastObservedMinutes ?? 0,
        });
        subscription = { ...subscription, firedLeaveNow: true };
      }
      if (!subscription.predictedZeroAt) {
        return beginTracking(subscription, candidates[0], now);
      }

      const predictedAt = new Date(subscription.predictedZeroAt).getTime();
      if (predictedAt > now.getTime()) return subscription;

      const lateness = now.getTime() - predictedAt;
      if (lateness <= STALE_PREDICTION_GRACE_MS) {
        events.push({
          kind: "zero",
          lineId: subscription.lineId,
          vehicleKey: trackedVehicleKey,
          minutes: 0,
        });
      }
      return completeTrackedVehicle(subscription, candidates, now);
    }

    subscription = {
      ...subscription,
      predictedLeaveAt: predictedLeaveAt(tracked, now),
      predictedZeroAt: predictedZeroAt(tracked.minutes, now),
      lastObservedMinutes: tracked.minutes,
    };

    const leaveAt = subscription.predictedLeaveAt
      ? new Date(subscription.predictedLeaveAt).getTime()
      : null;
    if (
      leaveAt !== null &&
      leaveAt <= now.getTime() &&
      !subscription.firedLeaveNow
    ) {
      events.push({
        kind: "leave-now",
        lineId: subscription.lineId,
        vehicleKey: tracked.vehicleKey,
        minutes: tracked.minutes,
      });
      subscription = { ...subscription, firedLeaveNow: true };
    }

    if (tracked.minutes === 0) {
      events.push({
        kind: "zero",
        lineId: subscription.lineId,
        vehicleKey: tracked.vehicleKey,
        minutes: 0,
      });
      return completeTrackedVehicle(subscription, candidates, now);
    }

    if (tracked.minutes <= 1 && !subscription.firedOneMinute) {
      events.push({
        kind: "one-minute",
        lineId: subscription.lineId,
        vehicleKey: tracked.vehicleKey,
        minutes: tracked.minutes,
      });
      return { ...subscription, firedOneMinute: true };
    }

    return subscription;
  });

  return { subscriptions: nextSubscriptions, events };
}
