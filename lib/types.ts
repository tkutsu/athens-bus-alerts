export const OPTIONAL_THRESHOLDS = [10, 5, 3, 1] as const;

export type OptionalThreshold = (typeof OPTIONAL_THRESHOLDS)[number];

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface StopSummary extends Coordinates {
  code: string;
  name: string;
  street: string | null;
  distanceMeters: number;
}

export interface ServingRoute {
  routeCode: string;
  lineId: string;
  description: string;
}

export interface ServingLine {
  lineId: string;
  description: string;
}

export interface Arrival {
  routeCode: string;
  vehicleId: string;
  minutes: number;
}

export interface LineAlertConfig {
  lineId: string;
  optionalThresholds: OptionalThreshold[];
}

export interface Favorite {
  id: string;
  name: string;
  stop: Pick<StopSummary, "code" | "name">;
  lineAlerts: LineAlertConfig[];
  createdAt: string;
  updatedAt: string;
  lastEnabledAt: string | null;
}

export interface ActiveLineAlert extends LineAlertConfig {
  firedThresholds: Array<OptionalThreshold | 0>;
  predictedZeroAt: string | null;
  lastObservedMinutes: number | null;
  completedAt: string | null;
}

export interface ActiveAlarm {
  id: string;
  stopCode: string;
  stopName: string;
  lineAlerts: ActiveLineAlert[];
  armedAt: string;
  completedAt: string | null;
}

export interface StoredState {
  version: 3;
  selectedStop: Pick<StopSummary, "code" | "name"> | null;
  lineAlerts: LineAlertConfig[];
  favorites: Favorite[];
  activeAlarm: ActiveAlarm | null;
}

export interface ApiErrorPayload {
  error: {
    code:
      | "INVALID_INPUT"
      | "NOT_FOUND"
      | "OASA_UNAVAILABLE"
      | "OASA_INVALID_RESPONSE";
    message: string;
    retryable: boolean;
  };
}
