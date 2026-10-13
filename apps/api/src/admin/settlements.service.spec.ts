import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SettlementsService } from './settlements.service.js';

const restaurantId = '40000000-0000-4000-8000-000000000001';
const orderId = '50000000-0000-4000-8000-000000000001';
const generatedAt = new Date('2026-10-05T10:00:00.000Z');

function setup() {
  const order = {
    id: orderId,
    restaurantId,
    currency: 'INR',
    status: 'DELIVERED',
    subtotalMinor: 10000,
    discountMinor: 1000,
    delivery: { deliveredAt: generatedAt },
    intent: { coupon: { restaurantId } },
    refunds: [{ restaurantAdjustmentMinor: 500 }],
  };
  const commissionRule = {
    id: '60000000-0000-4000-8000-000000000001',
    ruleKey: 'default-commission',
    version: 2,
    restaurantId: null,
    rateBps: 1000,
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    effectiveUntil: null,
  };
  const transaction = {
    restaurantSettlement: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'settlement-id',
        ...data,
      })),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'settlement-id', status: 'APPROVED' }),
    },
    settlementAdjustment: { create: vi.fn().mockResolvedValue({ id: 'adjustment-id' }) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    order: { findMany: vi.fn().mockResolvedValue([order]) },
    commissionRule: { findMany: vi.fn().mockResolvedValue([commissionRule]) },
    restaurantSettlement: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
      operation(transaction),
    ),
  };
  const service = new SettlementsService(prisma as never);
  return { order, commissionRule, transaction, prisma, service };
}

describe('SettlementsService', () => {
  it('snapshots restaurant discount, attributed refund, commission version, and net in minor units', async () => {
    const { transaction, service } = setup();

    const result = await service.generate({ id: 'generator-id' } as never, {
      restaurantId,
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-08T00:00:00.000Z',
    });

    expect(result).toMatchObject({ reused: false, items: [{ netAmountMinor: 7650 }] });
    expect(transaction.restaurantSettlement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        grossItemMinor: 10000,
        restaurantDiscountMinor: 1000,
        refundAdjustmentMinor: 500,
        commissionBasisMinor: 8500,
        commissionMinor: 850,
        netAmountMinor: 7650,
        items: {
          create: [
            expect.objectContaining({
              orderId,
              commissionRuleVersion: 2,
              commissionBasisMinor: 8500,
              commissionMinor: 850,
            }),
          ],
        },
      }),
    });
  });

  it('refuses to generate a settlement when no effective commission rule exists', async () => {
    const { prisma, service } = setup();
    prisma.commissionRule.findMany.mockResolvedValue([]);

    await expect(
      service.generate({ id: 'generator-id' } as never, {
        restaurantId,
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-10-08T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('prevents a settlement generator from approving their own draft', async () => {
    const { transaction, service } = setup();
    transaction.restaurantSettlement.findUnique.mockResolvedValue({
      id: 'settlement-id',
      generatedByUserId: 'same-actor',
      status: 'DRAFT',
    });

    await expect(
      service.approve({ id: 'same-actor' } as never, 'settlement-id'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction.restaurantSettlement.updateMany).not.toHaveBeenCalled();
  });
});
