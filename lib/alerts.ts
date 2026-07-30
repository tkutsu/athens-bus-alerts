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
  lineId: string;
  minutes: number;
  threshold: OptionalThreshold | 0;
}

export interface AlarmEvaluation {
  alarm: ActiveAlarm;
  events: AlertEvent[];
}

/** Advances every configured bus independently from its earliest arrival. */
export function evaluateAlarm(
  alarm: ActiveAlarm,
  arrivals: CandidateArrival[],
  now = new Date(),
): AlarmEvaluation {
  if (alarm.completedAt) {
    return { alarm, events: [] };
  }

  const events: AlertEvent[] = [];
  const lineAlerts = alarm.lineAlerts.map((lineAlarm) => {
    if (lineAlarm.completedAt) return lineAlarm;

    const earliest = arrivals
      .filter((arrival) => arrival.lineId === lineAlarm.lineId)
      .sort((a, b) => a.minutes - b.minutes)[0];
    const predictedZeroAt = earliest
      ? new Date(now.getTime() + earliest.minutes * 60_000).toISOString()
      : lineAlarm.predictedZeroAt;

    if (
      earliest?.minutes === 0 ||
      (predictedZeroAt &&
        new Date(predictedZeroAt).getTime() <= now.getTime())
    ) {
      events.push({
        kind: "zero",
        lineId: lineAlarm.lineId,
        minutes: 0,
        threshold: 0,
      });
      return {
        ...lineAlarm,
        firedThresholds: [
          ...new Set([...lineAlarm.firedThresholds, 0 as const]),
        ],
        predictedZeroAt: null,
        lastObservedMinutes: 0,
        completedAt: now.toISOString(),
      };
    }

    if (!earliest) {
      return { ...lineAlarm, predictedZeroAt };
    }

    const crossedThresholds = lineAlarm.optionalThresholds.filter(
      (threshold) =>
        !lineAlarm.firedThresholds.includes(threshold) &&
        earliest.minutes <= threshold,
    );
    if (crossedThresholds.length === 0) {
      return {
        ...lineAlarm,
        predictedZeroAt,
        lastObservedMinutes: earliest.minutes,
      };
    }

    // Report only the closest crossed warning to avoid a burst when OASA jumps.
    const threshold = Math.min(...crossedThresholds) as OptionalThreshold;
    const allCrossed = lineAlarm.optionalThresholds.filter(
      (candidate) => earliest.minutes <= candidate,
    );
    events.push({
      kind: "warning",
      lineId: lineAlarm.lineId,
      minutes: earliest.minutes,
      threshold,
    });
    return {
      ...lineAlarm,
      firedThresholds: [
        ...new Set([...lineAlarm.firedThresholds, ...allCrossed]),
      ],
      predictedZeroAt,
      lastObservedMinutes: earliest.minutes,
    };
  });

  const completed = lineAlerts.every((lineAlarm) => lineAlarm.completedAt);
  return {
    alarm: {
      ...alarm,
      lineAlerts,
      completedAt: completed ? now.toISOString() : null,
    },
    events,
  };
}
