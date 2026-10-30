"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  evaluateSubscriptions,
  type AlertEvent,
  type CandidateArrival,
} from "@/lib/alerts";
import type { LineSubscription } from "@/lib/types";

interface AlertSnapshot {
  stopCode: string;
  observedAt: string;
  candidates: readonly CandidateArrival[];
}

interface LineAlertsOptions {
  snapshot: AlertSnapshot | null;
  subscriptions: LineSubscription[];
  onChange: (subscriptions: LineSubscription[]) => void;
  onEvents: (events: readonly AlertEvent[]) => void;
}

/** Evaluates new snapshots and selections, then schedules their absolute predictions. */
export function useLineAlerts({
  snapshot,
  subscriptions,
  onChange,
  onEvents,
}: LineAlertsOptions) {
  const subscriptionsRef = useRef(subscriptions);
  const evaluatedRef = useRef<string | null>(null);
  const processedSubscriptionsRef = useRef(new Set<LineSubscription>());

  useEffect(() => {
    subscriptionsRef.current = subscriptions;
  }, [subscriptions]);

  const process = useCallback(
    (candidates: readonly CandidateArrival[], now: Date) => {
      const evaluation = evaluateSubscriptions(subscriptionsRef.current, candidates, now);
      subscriptionsRef.current = evaluation.subscriptions;
      processedSubscriptionsRef.current = new Set(evaluation.subscriptions);
      onChange(evaluation.subscriptions);
      onEvents(evaluation.events);
    },
    [onChange, onEvents],
  );

  useEffect(() => {
    if (!snapshot) return;
    const key = JSON.stringify([snapshot.stopCode, snapshot.observedAt]);
    // Fresh favorites can select the same routes; only our own results may skip evaluation.
    if (evaluatedRef.current === key && subscriptions.every(
      (subscription) => processedSubscriptionsRef.current.has(subscription),
    )) return;
    evaluatedRef.current = key;
    process(snapshot.candidates, new Date(snapshot.observedAt));
  }, [snapshot, subscriptions, process]);

  const available = snapshot !== null;
  useEffect(() => {
    if (!available) return;
    const nextPredicted = subscriptions
      .flatMap((subscription) => [
        subscription.firedLeaveNow ? null : subscription.predictedLeaveAt,
        subscription.predictedZeroAt,
      ])
      .filter((value): value is string => Boolean(value))
      .sort()[0];
    if (!nextPredicted) return;
    const delay = Math.max(0, Date.parse(nextPredicted) - Date.now());
    const timeout = window.setTimeout(
      () => process([], new Date()),
      Math.min(delay, 2_147_000_000),
    );
    return () => window.clearTimeout(timeout);
  }, [available, process, subscriptions]);
}
