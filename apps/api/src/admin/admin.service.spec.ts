import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminService } from './admin.service.js';

const now = new Date('2026-10-08T12:00:00.000Z');

function setup() {
  const prisma = {
    order: { count: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
    paymentAttempt: { groupBy: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    refund: { groupBy: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    user: { count: vi.fn(), findMany: vi.fn() },
    restaurant: { count: vi.fn() },
    auditLog: { findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
  };
  const service = new AdminService(prisma as never);
  return { prisma, service };
}

describe('AdminService', () => {
  beforeEach(() => vi.setSystemTime(now));

  it('uses an inclusive start and exclusive end for dashboard metrics', async () => {
    const { prisma, service } = setup();
    prisma.order.count.mockResolvedValue(4);
    prisma.order.groupBy.mockResolvedValue([
      { currency: 'INR', _count: { _all: 2 }, _sum: { totalMinor: 1800 } },
    ]);
    prisma.paymentAttempt.groupBy.mockResolvedValue([]);
    prisma.refund.groupBy.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(1);
    prisma.restaurant.count.mockResolvedValue(0);

    const result = await service.dashboard('2026-10-01T00:00:00.000Z', '2026-10-08T00:00:00.000Z');

    expect(prisma.order.count).toHaveBeenCalledWith({
      where: {
        createdAt: {
          gte: new Date('2026-10-01T00:00:00.000Z'),
          lt: new Date('2026-10-08T00:00:00.000Z'),
        },
      },
    });
    expect(result.orders).toEqual({
      count: 4,
      delivered: [expect.objectContaining({ currency: 'INR' })],
    });
  });

  it('rejects reversed and oversized report ranges', async () => {
    const { service } = setup();
    await expect(
      service.reports('2026-10-08T00:00:00.000Z', '2026-10-07T00:00:00.000Z'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.reports('2024-01-01T00:00:00.000Z', '2026-10-08T00:00:00.000Z'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('limits audit data and records that the audit log was viewed', async () => {
    const { prisma, service } = setup();
    prisma.auditLog.findMany.mockResolvedValue([]);
    prisma.auditLog.count.mockResolvedValue(0);
    prisma.auditLog.create.mockResolvedValue({});

    const result = await service.auditLogs('admin-id', { action: 'ROLE', page: '2', limit: '20' });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 20, orderBy: { createdAt: 'desc' } }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorUserId: 'admin-id', action: 'AUDIT_LOGS_VIEWED' }),
    });
    expect(result).toMatchObject({ page: 2, limit: 20, total: 0 });
  });

  it('rejects invalid operational statuses and unbounded page sizes', async () => {
    const { service } = setup();
    await expect(service.orders({ status: 'UNKNOWN' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.users(undefined, '1', '101')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('exports aggregate-only CSV rows and neutralizes spreadsheet formulas', async () => {
    const { prisma, service } = setup();
    prisma.order.groupBy.mockResolvedValue([
      {
        status: 'DELIVERED',
        currency: '=1+1',
        _count: { _all: 2 },
        _sum: {
          subtotalMinor: 1000,
          discountMinor: 0,
          feesMinor: 100,
          taxMinor: 50,
          tipMinor: 0,
          totalMinor: 1150,
        },
      },
    ]);
    prisma.paymentAttempt.groupBy.mockResolvedValue([]);
    prisma.refund.groupBy.mockResolvedValue([]);

    const csv = await service.reportsCsv();

    expect(csv).toContain('"order","DELIVERED","\'=1+1","2","1000"');
    expect(csv).not.toContain('email');
  });
});
