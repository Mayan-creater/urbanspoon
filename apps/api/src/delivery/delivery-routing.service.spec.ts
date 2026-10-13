import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeliveryRoutingService } from './delivery-routing.service.js';

describe('DeliveryRoutingService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses Google Routes road distance and duration when an API key is configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ routes: [{ distanceMeters: 4250, duration: '541s' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const service = new DeliveryRoutingService('google-test-key');

    await expect(
      service.route({ latitude: 12.9, longitude: 77.5 }, { latitude: 13, longitude: 77.6 }),
    ).resolves.toEqual({ distanceKm: 4.25, durationMinutes: 10 });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Goog-Api-Key': 'google-test-key',
          'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
        }),
        body: expect.stringContaining('"latitude":12.9'),
      }),
    );
  });

  it('uses no remote endpoint when unconfigured and falls back to OSRM after provider errors', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network unavailable'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      new DeliveryRoutingService().route(
        { latitude: 12.9, longitude: 77.5 },
        { latitude: 13, longitude: 77.6 },
      ),
    ).resolves.toBeNull();
    await expect(
      new DeliveryRoutingService('', 'http://router').route(
        { latitude: 12.9, longitude: 77.5 },
        { latitude: 13, longitude: 77.6 },
      ),
    ).resolves.toBeNull();
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining('/route/v1/driving/'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
