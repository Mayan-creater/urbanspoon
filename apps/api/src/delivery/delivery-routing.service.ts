export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface RoadRoute {
  distanceKm: number;
  durationMinutes: number;
}

interface OsrmResponse {
  code?: string;
  routes?: Array<{ distance?: number; duration?: number }>;
}

interface GoogleRoutesResponse {
  routes?: Array<{ distanceMeters?: number; duration?: string }>;
}

export class DeliveryRoutingService {
  constructor(
    private readonly apiKey = process.env.GOOGLE_MAPS_API_KEY ?? '',
    private readonly osrmBaseUrl = process.env.DELIVERY_ROUTING_URL ?? '',
  ) {}

  async route(from: Coordinates, to: Coordinates): Promise<RoadRoute | null> {
    if (this.apiKey) {
      const managedRoute = await this.googleRoute(from, to);
      if (managedRoute) return managedRoute;
    }
    if (!this.osrmBaseUrl) return null;
    try {
      const base = this.osrmBaseUrl.replace(/\/$/, '');
      const response = await fetch(
        `${base}/route/v1/driving/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=false&alternatives=false&steps=false`,
        { signal: AbortSignal.timeout(2500) },
      );
      if (!response.ok) return null;
      const body = (await response.json()) as OsrmResponse;
      const route = body.code === 'Ok' ? body.routes?.[0] : undefined;
      if (
        !route ||
        !Number.isFinite(route.distance) ||
        !Number.isFinite(route.duration) ||
        route.distance! < 0 ||
        route.duration! < 0
      ) {
        return null;
      }
      return {
        distanceKm: route.distance! / 1000,
        durationMinutes: Math.max(1, Math.ceil(route.duration! / 60)),
      };
    } catch {
      return null;
    }
  }

  private async googleRoute(from: Coordinates, to: Coordinates): Promise<RoadRoute | null> {
    try {
      const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: from.latitude, longitude: from.longitude } } },
          destination: {
            location: { latLng: { latitude: to.latitude, longitude: to.longitude } },
          },
          travelMode: 'DRIVE',
          units: 'METRIC',
        }),
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) return null;
      const body = (await response.json()) as GoogleRoutesResponse;
      const route = body.routes?.[0];
      const durationSeconds = route?.duration?.endsWith('s')
        ? Number(route.duration.slice(0, -1))
        : Number.NaN;
      if (
        !route ||
        !Number.isFinite(route.distanceMeters) ||
        !Number.isFinite(durationSeconds) ||
        route.distanceMeters! < 0 ||
        durationSeconds < 0
      ) {
        return null;
      }
      return {
        distanceKm: route.distanceMeters! / 1000,
        durationMinutes: Math.max(1, Math.ceil(durationSeconds / 60)),
      };
    } catch {
      return null;
    }
  }
}
