import { describe, expect, it, vi } from 'vitest';
import { HealthService } from './health.service.js';

describe('HealthService', () => {
  it('reports readiness only after the database responds', async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const service = new HealthService(prisma as never);

    await expect(service.checkReadiness()).resolves.toMatchObject({
      status: 'ok',
      dependencies: { database: 'connected' },
    });
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
  });

  it('does not report readiness when the database check fails', async () => {
    const prisma = { $queryRaw: vi.fn().mockRejectedValue(new Error('offline')) };
    const service = new HealthService(prisma as never);

    await expect(service.checkReadiness()).rejects.toMatchObject({
      status: 503,
      message: 'Database is unavailable',
    });
  });
});
