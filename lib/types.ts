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
  descriptionEl: string;
  descriptionEn: string | null;
  destination: string;
  routeType: string | null;
  routeDistanceMeters: number | null;
}

export interface Arrival {
  routeCode: string;
  vehicleId: string;
  minutes: number;
}

export interface RouteStop extends Coordinates {
  code: string;
  name: string;
  street: string | null;
  order: number;
}

export interface RouteShapePoint extends Coordinates {
  order: number;
}

export interface RouteDetails {
  routeCode: string;
  origin: string;
  destination: string;
  isCircular: boolean;
  stops: RouteStop[];
  shape: RouteShapePoint[];
}

export interface UserLocation extends Coordinates {
  accuracyMeters: number;
  observedAt: string;
}

export interface RecentVehicle {
  key: string;
  completedAt: string;
}

export interface LineSubscription {
  lineId: string;
  routeCode: string | null;
  trackedVehicleKey: string | null;
  firedLeaveNow: boolean;
  firedOneMinute: boolean;
  predictedLeaveAt: string | null;
  predictedZeroAt: string | null;
  lastObservedMinutes: number | null;
  recentVehicles: RecentVehicle[];
}

export interface Favorite {
  id: string;
  name: string;
  stop: Pick<StopSummary, "code" | "name">;
  routes: Array<{ lineId: string; routeCode: string | null }>;
  createdAt: string;
  updatedAt: string;
  lastEnabledAt: string | null;
}

export interface StoredState {
  version: 5;
  selectedStop: Pick<StopSummary, "code" | "name"> | null;
  subscriptions: LineSubscription[];
  favorites: Favorite[];
}

export interface ApiErrorPayload {
  error: {
    code:
      | "INVALID_INPUT"
      | "OASA_UNAVAILABLE"
      | "OASA_INVALID_RESPONSE";
    message: string;
    retryable: boolean;
  };
}
