import { describe, expect, it, vi } from 'vitest';
import { MembershipService } from './membership.service.js';

describe('MembershipService', () => {
  it('lists only effective active plans and exposes no active benefits while payment is gated', async () => {
    const plan = { id: 'plan-id', key: 'foodpass', version: 1, isActive: true };
    const prisma = {
      membershipPlan: { findMany: vi.fn().mockResolvedValue([plan]) },
      membership: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = new MembershipService(prisma as never);

    await expect(service.listAvailablePlans()).resolves.toEqual([plan]);
    expect(prisma.membershipPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isActive: true,
          effectiveFrom: { lte: expect.any(Date) },
        }),
      }),
    );
    await expect(service.currentMembership('customer-id')).resolves.toEqual({
      membership: null,
      activationAvailable: false,
    });
    expect(prisma.membership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'customer-id', status: 'ACTIVE' }),
      }),
    );
  });

  it('creates a new plan version and audits price, currency, benefits, and activation gate', async () => {
    const plan = {
      id: 'plan-v2',
      key: 'foodpass',
      name: 'FoodPass Plus',
      version: 2,
      priceMinor: 49900,
      currency: 'INR',
      interval: 'MONTHLY',
      benefits: ['Free delivery'],
      effectiveFrom: new Date('2026-11-01T00:00:00.000Z'),
      effectiveUntil: null,
    };
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      membershipPlan: {
        findFirst: vi.fn().mockResolvedValue({
          version: 1,
          effectiveFrom: new Date('2026-10-01T00:00:00.000Z'),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue(plan),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new MembershipService(prisma as never);

    await expect(
      service.createPlan('admin-id', {
        key: 'foodpass',
        name: 'FoodPass Plus',
        description: 'Monthly dining benefits',
        priceMinor: 49900,
        currency: 'INR',
        interval: 'MONTHLY',
        benefits: [' Free delivery '],
        effectiveFrom: '2026-11-01T00:00:00.000Z',
      }),
    ).resolves.toEqual(plan);
    expect(transaction.membershipPlan.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ key: 'foodpass', version: 2, benefits: ['Free delivery'] }),
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: 'admin-id',
        action: 'MEMBERSHIP_PLAN_VERSION_CREATED',
        after: expect.objectContaining({ version: 2, activationAvailable: false }),
      }),
    });
  });
});