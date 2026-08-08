import type { Arrival } from "@/lib/types";

export type VehicleConfidence = "normal" | "stale" | "unconfirmed" | "slipping";

interface EtaSample {
  minutes: number;
  observedAtMs: number;
}

export interface VehicleConfidenceRecord {
  arrival: Arrival;
  samples: EtaSample[];
  lastSnapshotAtMs: number;
  missingSnapshots: number;
  slipHits: number;
  clearHits: number;
}

export interface ConfidenceUpdate {
  records: Map<string, VehicleConfidenceRecord>;
  arrivals: Array<Arrival & { confidence: VehicleConfidence }>;
}

const STALE_ARRIVAL_MS = 90_000;

function vehicleKey(arrival: Pick<Arrival, "routeCode" | "vehicleId">) {
  return `${arrival.routeCode}:${arrival.vehicleId}`;
}

function isSlipping(samples: readonly EtaSample[]): boolean {
  if (samples.length < 3) return false;
  const first = samples[0];
  const last = samples.at(-1)!;
  const elapsedMinutes = (last.observedAtMs - first.observedAtMs) / 60_000;
  if (elapsedMinutes < 1 || elapsedMinutes > 3) return false;
  const expected = Math.max(0, first.minutes - elapsedMinutes);
  return last.minutes - expected >= 2;
}

/** Retains brief ghosts and classifies noisy ETA movement across snapshots. */
export function updateVehicleConfidence(
  previous: ReadonlyMap<string, VehicleConfidenceRecord>,
  arrivals: readonly Arrival[],
  observedAt: string,
  nowMs = Date.now(),
): ConfidenceUpdate {
  const observedAtMs = new Date(observedAt).getTime();
  const stale = nowMs - observedAtMs > STALE_ARRIVAL_MS;
  const current = new Map(arrivals.map((arrival) => [vehicleKey(arrival), arrival]));
  const records = new Map<string, VehicleConfidenceRecord>();

  for (const [key, arrival] of current) {
    const old = previous.get(key);
    const priorSamples = (old?.samples ?? []).filter(
      (sample) => sample.observedAtMs !== observedAtMs,
    );
    const samples = [
      ...priorSamples,
      { minutes: arrival.minutes, observedAtMs },
    ].filter((sample) => observedAtMs - sample.observedAtMs <= 180_000);
    const slippingNow = isSlipping(samples);
    const repeatedSnapshot = old?.samples.at(-1)?.observedAtMs === observedAtMs;
    const clearHits = repeatedSnapshot
      ? old?.clearHits ?? 0
      : slippingNow
        ? 0
        : (old?.clearHits ?? 0) + 1;
    const slipHits = repeatedSnapshot
      ? old?.slipHits ?? 0
      : slippingNow
        ? (old?.slipHits ?? 0) + 1
        : clearHits >= 2
          ? 0
          : old?.slipHits ?? 0;
    records.set(key, {
      arrival,
      samples,
      lastSnapshotAtMs: observedAtMs,
      missingSnapshots: 0,
      slipHits,
      clearHits,
    });
  }

  for (const [key, old] of previous) {
    if (current.has(key) || old.arrival.minutes <= 0) continue;
    const missingSnapshots =
      old.lastSnapshotAtMs === observedAtMs
        ? old.missingSnapshots
        : old.missingSnapshots + 1;
    if (missingSnapshots > 1) continue;
    if (nowMs - old.samples.at(-1)!.observedAtMs > 120_000) continue;
    records.set(key, { ...old, lastSnapshotAtMs: observedAtMs, missingSnapshots });
  }

  return {
    records,
    arrivals: [...records.values()]
      .map((record) => ({
        ...record.arrival,
        confidence: stale
          ? "stale" as const
          : record.missingSnapshots > 0
            ? "unconfirmed" as const
            : record.slipHits >= 2
              ? "slipping" as const
              : "normal" as const,
      }))
      .sort((a, b) => a.minutes - b.minutes),
  };
}
