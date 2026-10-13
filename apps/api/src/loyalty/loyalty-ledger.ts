import type { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import {
  calculateRedemption,
  calculateTieredEarnedPoints,
  loyaltyTier,
} from './loyalty-calculation.js';

type LoyaltyOrder = {
  id: string;
  userId: string;
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
};

export async function recordDeliveredOrderEarning(
  transaction: Prisma.TransactionClient,
  order: LoyaltyOrder,
  occurredAt: Date,
) {
  const rule = await transaction.loyaltyRule.findFirst({
    where: {
      currency: order.currency,
      isActive: true,
      effectiveFrom: { lte: occurredAt },
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: occurredAt } }],
    },
    orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
  });
  if (!rule) return null;

  const eligibleSubtotalMinor = Math.max(0, order.subtotalMinor - order.discountMinor);
  const lifetime = await transaction.loyaltyTransaction.aggregate({
    where: { userId: order.userId, type: { in: ['EARN', 'REFUND_REVERSAL'] } },
    _sum: { points: true },
  });
  const tier = loyaltyTier(lifetime._sum.points ?? 0);
  const points = calculateTieredEarnedPoints(
    eligibleSubtotalMinor,
    rule.earnRateBps,
    tier.multiplierBps,
  );
  if (!points) return null;

  return transaction.loyaltyTransaction.upsert({
    where: { idempotencyKey: `order:${order.id}:loyalty:earn` },
    create: {
      userId: order.userId,
      orderId: order.id,
      ruleId: rule.id,
      type: 'EARN',
      points,
      idempotencyKey: `order:${order.id}:loyalty:earn`,
      calculation: {
        ruleVersion: rule.version,
        tier: tier.name,
        tierMultiplierBps: tier.multiplierBps,
        currency: order.currency,
        eligibleSubtotalMinor,
        earnRateBps: rule.earnRateBps,
        formula: 'floor(eligibleSubtotalMinor * earnRateBps / 10000)',
      },
      expiresAt: new Date(occurredAt.getTime() + rule.pointsExpireAfterDays * 86_400_000),
    },
    update: {},
  });
}

export async function availableLoyaltyPoints(
  transaction: Prisma.TransactionClient,
  userId: string,
  now: Date,
) {
  const [ledger, reservations] = await Promise.all([
    transaction.loyaltyTransaction.aggregate({
      where: { userId, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      _sum: { points: true },
    }),
    transaction.loyaltyRedemption.aggregate({
      where: { userId, status: 'RESERVED' },
      _sum: { points: true },
    }),
  ]);
  return (ledger._sum.points ?? 0) - (reservations._sum.points ?? 0);
}

export function calculateLoyaltyRedemption(
  points: number,
  availablePoints: number,
  eligibleSubtotalMinor: number,
  redeemMinorPerPoint: number,
) {
  try {
    return calculateRedemption(points, availablePoints, eligibleSubtotalMinor, redeemMinorPerPoint);
  } catch (error) {
    if (error instanceof RangeError) throw new BadRequestException(error.message);
    throw error;
  }
}

export async function reserveLoyaltyRedemption(
  transaction: Prisma.TransactionClient,
  input: {
    userId: string;
    orderIntentId: string;
    ruleId: string;
    points: number;
    discountMinor: number;
    currency: string;
  },
) {
  return transaction.loyaltyRedemption.create({ data: { ...input, status: 'RESERVED' } });
}

export async function releaseLoyaltyRedemption(
  transaction: Prisma.TransactionClient,
  orderIntentId: string,
) {
  return transaction.loyaltyRedemption.updateMany({
    where: { orderIntentId, status: 'RESERVED' },
    data: { status: 'RELEASED' },
  });
}

export async function consumeLoyaltyRedemption(
  transaction: Prisma.TransactionClient,
  orderId: string,
  orderIntentId: string,
) {
  const redemption = await transaction.loyaltyRedemption.findUnique({ where: { orderIntentId } });
  if (!redemption || redemption.status !== 'RESERVED') return null;
  const changed = await transaction.loyaltyRedemption.updateMany({
    where: { id: redemption.id, status: 'RESERVED' },
    data: { status: 'CONSUMED' },
  });
  if (!changed.count) return null;
  return transaction.loyaltyTransaction.create({
    data: {
      userId: redemption.userId,
      orderId,
      orderIntentId,
      ruleId: redemption.ruleId,
      type: 'REDEMPTION',
      points: -redemption.points,
      idempotencyKey: `order:${orderId}:loyalty:redeem`,
      calculation: {
        points: redemption.points,
        discountMinor: redemption.discountMinor,
        currency: redemption.currency,
      },
    },
  });
}

export async function restoreLoyaltyRedemption(
  transaction: Prisma.TransactionClient,
  orderId: string,
  orderIntentId: string,
  refundReference: string,
) {
  const redemption = await transaction.loyaltyRedemption.findUnique({ where: { orderIntentId } });
  if (!redemption || redemption.status !== 'CONSUMED') return null;
  const restored = await transaction.loyaltyRedemption.updateMany({
    where: { id: redemption.id, status: 'CONSUMED' },
    data: { status: 'RESTORED' },
  });
  if (!restored.count) return null;
  const idempotencyKey = `refund:${refundReference}:loyalty:restore`;
  return transaction.loyaltyTransaction.upsert({
    where: { idempotencyKey },
    create: {
      userId: redemption.userId,
      orderId,
      orderIntentId,
      ruleId: redemption.ruleId,
      type: 'REFUND_RESTORATION',
      points: redemption.points,
      idempotencyKey,
      calculation: { points: redemption.points, refundReference },
      expiresAt: new Date(Date.now() + 365 * 86_400_000),
    },
    update: {},
  });
}

export async function reverseEarnedLoyalty(
  transaction: Prisma.TransactionClient,
  orderId: string,
  orderIntentId: string,
  refundId: string,
) {
  const earning = await transaction.loyaltyTransaction.findUnique({
    where: { idempotencyKey: `order:${orderId}:loyalty:earn` },
  });
  if (!earning || earning.type !== 'EARN') return null;
  const idempotencyKey = `refund:${refundId}:loyalty:reverse-earned`;
  return transaction.loyaltyTransaction.upsert({
    where: { idempotencyKey },
    create: {
      userId: earning.userId,
      orderId,
      orderIntentId,
      refundId,
      ruleId: earning.ruleId,
      type: 'REFUND_REVERSAL',
      points: -earning.points,
      idempotencyKey,
      calculation: { reversedTransactionId: earning.id, points: earning.points, refundId },
    },
    update: {},
  });
}