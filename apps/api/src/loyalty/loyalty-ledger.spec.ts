import { describe, expect, it, vi } from 'vitest';
import { recordDeliveredOrderEarning } from './loyalty-ledger.js';

const order = {
  id: 'order-id',
  userId: 'customer-id',
  currency: 'INR',
  subtotalMinor: 10_000,
  discountMinor: 1_000,
};

describe('recordDeliveredOrderEarning', () => {
  it('awards points using the active currency rule and net item subtotal', async () => {
    const rule = { id: 'rule-id', version: 2, earnRateBps: 100, pointsExpireAfterDays: 365 };
    const occurredAt = new Date('2026-10-09T00:00:00Z');
    const transaction = {
      loyaltyRule: { findFirst: vi.fn().mockResolvedValue(rule) },
      loyaltyTransaction: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { points: 0 } }),
        upsert: vi.fn().mockResolvedValue({ points: 90 }),
      },
    };

    await expect(
      recordDeliveredOrderEarning(transaction as never, order, occurredAt),
    ).resolves.toMatchObject({ points: 90 });
    expect(transaction.loyaltyRule.findFirst).toHaveBeenCalledWith({
      where: {
        currency: 'INR',
        isActive: true,
        effectiveFrom: { lte: occurredAt },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: occurredAt } }],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
    });
    expect(transaction.loyaltyTransaction.upsert).toHaveBeenCalledWith({
      where: { idempotencyKey: 'order:order-id:loyalty:earn' },
      create: expect.objectContaining({
        userId: 'customer-id',
        points: 90,
        type: 'EARN',
        expiresAt: new Date(occurredAt.getTime() + 365 * 86_400_000),
        calculation: expect.objectContaining({
          ruleVersion: 2,
          tier: 'BRONZE',
          eligibleSubtotalMinor: 9_000,
        }),
      }),
      update: {},
    });
  });

  it('uses lifetime earnings to select the multiplier for a later delivered order', async () => {
    const rule = { id: 'rule-id', version: 3, earnRateBps: 100, pointsExpireAfterDays: 365 };
    const transaction = {
      loyaltyRule: { findFirst: vi.fn().mockResolvedValue(rule) },
      loyaltyTransaction: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { points: 500 } }),
        upsert: vi.fn().mockResolvedValue({ points: 110 }),
      },
    };

    await expect(
      recordDeliveredOrderEarning(transaction as never, { ...order, discountMinor: 0 }, new Date()),
    ).resolves.toMatchObject({ points: 110 });
    expect(transaction.loyaltyTransaction.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          points: 110,
          calculation: expect.objectContaining({ tier: 'SILVER', tierMultiplierBps: 11_000 }),
        }),
      }),
    );
  });

  it('does not create an earning without a matching active rule', async () => {
    const transaction = {
      loyaltyRule: { findFirst: vi.fn().mockResolvedValue(null) },
      loyaltyTransaction: { upsert: vi.fn() },
    };

    await expect(
      recordDeliveredOrderEarning(transaction as never, order, new Date()),
    ).resolves.toBeNull();
    expect(transaction.loyaltyTransaction.upsert).not.toHaveBeenCalled();
  });

  it('does not create zero-point entries', async () => {
    const transaction = {
      loyaltyRule: { findFirst: vi.fn().mockResolvedValue({ id: 'rule-id', version: 1, earnRateBps: 1 }) },
      loyaltyTransaction: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { points: 0 } }),
        upsert: vi.fn(),
      },
    };

    await expect(
      recordDeliveredOrderEarning(
        transaction as never,
        { ...order, subtotalMinor: 1, discountMinor: 0 },
        new Date(),
      ),
    ).resolves.toBeNull();
    expect(transaction.loyaltyTransaction.upsert).not.toHaveBeenCalled();
  });
});