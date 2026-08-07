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

export interface RecentVehicle {
  key: string;
  completedAt: string;
}

export interface LineSubscription {
  lineId: string;
  trackedVehicleKey: string | null;
  firedOneMinute: boolean;
  predictedZeroAt: string | null;
  lastObservedMinutes: number | null;
  recentVehicles: RecentVehicle[];
}

export interface Favorite {
  id: string;
  name: string;
  stop: Pick<StopSummary, "code" | "name">;
  lineIds: string[];
  createdAt: string;
  updatedAt: string;
  lastEnabledAt: string | null;
}

export interface StoredState {
  version: 4;
  selectedStop: Pick<StopSummary, "code" | "name"> | null;
  subscriptions: LineSubscription[];
  favorites: Favorite[];
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
