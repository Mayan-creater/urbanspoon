import { describe, expect, it, vi } from 'vitest';
import { LoyaltyService } from './loyalty.service.js';

describe('LoyaltyService', () => {
  it("returns only the authenticated customer's balance and recent ledger entries", async () => {
    const entries = [{ id: 'entry-id', points: 10 }];
    const transaction = {
      loyaltyTransaction: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { points: 10 } }),
        findMany: vi.fn().mockResolvedValue(entries),
      },
      loyaltyRedemption: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { points: 0 } }),
      },
    };
    const prisma = {
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new LoyaltyService(prisma as never);

    await expect(service.wallet('customer-id')).resolves.toEqual({
      balancePoints: 10,
      lifetimeEarnedPoints: 10,
      tier: { name: 'BRONZE', threshold: 0, multiplierBps: 10_000 },
      transactions: entries,
    });
    expect(transaction.loyaltyTransaction.aggregate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'customer-id', OR: expect.any(Array) }),
        _sum: { points: true },
      }),
    );
    expect(transaction.loyaltyTransaction.aggregate).toHaveBeenNthCalledWith(2, {
      where: { userId: 'customer-id', type: { in: ['EARN', 'REFUND_REVERSAL'] } },
      _sum: { points: true },
    });
    expect(transaction.loyaltyTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'customer-id' }, take: 50 }),
    );
  });

  it('creates the next immutable rule version and audits its effective dates', async () => {
    const created = {
      id: 'rule-id',
      currency: 'INR',
      version: 4,
      earnRateBps: 125,
      effectiveFrom: new Date('2026-10-09T00:00:00.000Z'),
      effectiveUntil: null,
    };
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      loyaltyRule: {
        findFirst: vi.fn().mockResolvedValue({ version: 3 }),
        create: vi.fn().mockResolvedValue(created),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new LoyaltyService(prisma as never);

    await expect(
      service.createRule('admin-id', {
        currency: 'INR',
        earnRateBps: 125,
        effectiveFrom: '2026-10-09T00:00:00.000Z',
      }),
    ).resolves.toEqual(created);
    expect(transaction.loyaltyRule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ currency: 'INR', version: 4, earnRateBps: 125 }),
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: 'admin-id',
        action: 'LOYALTY_EARNING_RULE_CREATED',
        entityId: 'rule-id',
      }),
    });
  });
});