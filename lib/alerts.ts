import type {
  ActiveAlarm,
  OptionalThreshold,
} from "@/lib/types";

export interface CandidateArrival {
  lineId: string;
  minutes: number;
}

export interface AlertEvent {
  kind: "warning" | "zero";
  lineId: string | null;
  minutes: number;
  threshold: OptionalThreshold | 0;
}

export interface AlarmEvaluation {
  alarm: ActiveAlarm;
  event: AlertEvent | null;
}

/** Advances a shared multi-line alarm using the earliest selected arrival. */
export function evaluateAlarm(
  alarm: ActiveAlarm,
  arrivals: CandidateArrival[],
  now = new Date(),
): AlarmEvaluation {
  if (alarm.completedAt) {
    return { alarm, event: null };
  }

  const eligible = arrivals
    .filter((arrival) => alarm.selectedLineIds.includes(arrival.lineId))
    .sort((a, b) => a.minutes - b.minutes);
  const earliest = eligible[0];
  const predictedZeroAt = earliest
    ? new Date(now.getTime() + earliest.minutes * 60_000).toISOString()
    : alarm.predictedZeroAt;

  if (
    earliest?.minutes === 0 ||
    (predictedZeroAt &&
      new Date(predictedZeroAt).getTime() <= now.getTime())
  ) {
    return {
      alarm: {
        ...alarm,
        firedThresholds: [
          ...new Set([...alarm.firedThresholds, 0 as const]),
        ],
        predictedZeroAt: null,
        lastObservedLineId:
          earliest?.lineId ?? alarm.lastObservedLineId,
        lastObservedMinutes: 0,
        completedAt: now.toISOString(),
      },
      event: {
        kind: "zero",
        lineId: earliest?.lineId ?? alarm.lastObservedLineId,
        minutes: 0,
        threshold: 0,
      },
    };
  }

  if (!earliest) {
    return {
      alarm: { ...alarm, predictedZeroAt },
      event: null,
    };
  }

  const crossedThresholds = alarm.optionalThresholds.filter(
    (threshold) =>
      !alarm.firedThresholds.includes(threshold) &&
      earliest.minutes <= threshold,
  );

  const updatedAlarm: ActiveAlarm = {
    ...alarm,
    predictedZeroAt,
    lastObservedLineId: earliest.lineId,
    lastObservedMinutes: earliest.minutes,
  };

  if (crossedThresholds.length === 0) {
    return { alarm: updatedAlarm, event: null };
  }

  // Report only the closest crossed warning to avoid a burst when OASA jumps.
  const threshold = Math.min(...crossedThresholds) as OptionalThreshold;
  const allCrossed = alarm.optionalThresholds.filter(
    (candidate) => earliest.minutes <= candidate,
  );

  return {
    alarm: {
      ...updatedAlarm,
      firedThresholds: [
        ...new Set([...alarm.firedThresholds, ...allCrossed]),
      ],
    },
    event: {
      kind: "warning",
      lineId: earliest.lineId,
      minutes: earliest.minutes,
      threshold,
    },
  };
}
