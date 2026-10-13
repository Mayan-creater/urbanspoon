import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { CartsService } from '../carts/carts.service.js';
import {
  availableLoyaltyPoints,
  releaseLoyaltyRedemption,
  reserveLoyaltyRedemption,
} from '../loyalty/loyalty-ledger.js';
import type { CreateOrderIntentDto } from './order-intents.dto.js';

const intentSelect = {
  id: true,
  restaurantId: true,
  status: true,
  currency: true,
  subtotalMinor: true,
  discountMinor: true,
  feesMinor: true,
  taxMinor: true,
  tipMinor: true,
  totalMinor: true,
  checkoutSnapshot: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
  paymentAttempts: {
    select: {
      id: true,
      provider: true,
      status: true,
      amountMinor: true,
      currency: true,
      checkoutUrl: true,
      expiresAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' as const },
  },
  order: { select: { id: true, status: true } },
  events: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.OrderIntentSelect;

type IntentRecord = Prisma.OrderIntentGetPayload<{ select: typeof intentSelect }>;

@Injectable()
export class OrderIntentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly carts: CartsService,
  ) {}

  async create(
    userId: string,
    input: CreateOrderIntentDto,
    idempotencyKey: string | undefined,
    correlationId?: string,
  ): Promise<IntentRecord> {
    if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
      throw new BadRequestException('A 16-128 character Idempotency-Key header is required');
    }
    const existing = await this.prisma.orderIntent.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
      select: intentSelect,
    });
    if (existing) return this.expireIfDue(existing, userId);

    const preview = await this.carts.preview(userId, input);
    const ttlMinutes = Number(process.env.PAYMENT_INTENT_TTL_MINUTES ?? 15);
    if (!Number.isInteger(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > 60) {
      throw new ConflictException('Payment intent expiry configuration is invalid');
    }
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000);

    try {
      return await this.prisma.$transaction(async (transaction) => {
        if (preview.loyaltyRedemption) {
          await transaction.$queryRaw(
            Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`,
          );
          const rule = await transaction.loyaltyRule.findFirst({
            where: {
              id: preview.loyaltyRedemption.ruleId,
              currency: preview.currency,
              isActive: true,
              effectiveFrom: { lte: now },
              OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }],
            },
            select: { id: true, version: true, redeemMinorPerPoint: true },
          });
          if (
            !rule ||
            rule.version !== preview.loyaltyRedemption.ruleVersion ||
            rule.redeemMinorPerPoint * preview.loyaltyRedemption.points !==
              preview.loyaltyRedemption.discountMinor
          ) {
            throw new ConflictException('FoodCoins rule changed; refresh checkout and retry');
          }
          const availablePoints = await availableLoyaltyPoints(transaction, userId, now);
          if (availablePoints < preview.loyaltyRedemption.points) {
            throw new ConflictException('FoodCoins balance changed; refresh checkout and retry');
          }
        }

        let coupon: { id: string; code: string } | null = null;
        if (preview.coupon) {
          const candidate = await transaction.coupon.findUnique({
            where: { code: preview.coupon.code },
            select: {
              id: true,
              code: true,
              campaignKey: true,
              usageLimit: true,
              perUserLimit: true,
              firstOrderOnly: true,
            },
          });
          if (!candidate) throw new ConflictException('Coupon changed before intent creation');
          if (candidate.perUserLimit != null || candidate.firstOrderOnly) {
            await transaction.$queryRaw(
              Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`,
            );
          }
          if (candidate.firstOrderOnly) {
            const [existingOrder, reservedFirstOrderCoupon] = await Promise.all([
              transaction.order.count({ where: { userId } }),
              transaction.couponRedemption.findFirst({
                where: {
                  status: 'RESERVED',
                  coupon: { firstOrderOnly: true },
                  orderIntent: { userId, status: { in: ['OPEN', 'PAYMENT_PENDING'] } },
                },
                select: { id: true },
              }),
            ]);
            if (existingOrder || reservedFirstOrderCoupon) {
              throw new ConflictException('First-order coupon is no longer available');
            }
          }
          if (candidate.perUserLimit != null) {
            const priorRedemptions = await transaction.couponRedemption.count({
              where: {
                coupon: { campaignKey: candidate.campaignKey },
                status: { in: ['RESERVED', 'CONSUMED'] },
                orderIntent: { userId },
              },
            });
            if (priorRedemptions >= candidate.perUserLimit) {
              throw new ConflictException('Coupon customer usage limit was reached');
            }
          }
          const claimed = await transaction.coupon.updateMany({
            where: {
              id: candidate.id,
              isActive: true,
              startsAt: { lte: now },
              endsAt: { gte: now },
              OR: [
                { usageLimit: null },
                ...(candidate.usageLimit === null
                  ? []
                  : [{ usageCount: { lt: candidate.usageLimit } }]),
              ],
            },
            data: { usageCount: { increment: 1 } },
          });
          if (claimed.count !== 1) throw new ConflictException('Coupon usage limit was reached');
          coupon = candidate;
        }

        const intent = await transaction.orderIntent.create({
          data: {
            userId,
            restaurantId: preview.restaurant.id,
            idempotencyKey,
            status: 'OPEN',
            currency: preview.currency,
            subtotalMinor: preview.subtotalMinor,
            discountMinor: preview.discountMinor,
            feesMinor: preview.feesMinor,
            taxMinor: preview.taxMinor,
            tipMinor: preview.tipMinor ?? 0,
            totalMinor: preview.totalMinor,
            couponId: coupon?.id,
            couponCode: coupon?.code,
            checkoutSnapshot: {
              ...preview,
              expiresAt: expiresAt.toISOString(),
            } as unknown as Prisma.InputJsonValue,
            expiresAt,
          },
        });
        if (coupon) {
          await transaction.couponRedemption.create({
            data: { couponId: coupon.id, orderIntentId: intent.id, status: 'RESERVED' },
          });
        }
        if (preview.loyaltyRedemption) {
          await reserveLoyaltyRedemption(transaction, {
            userId,
            orderIntentId: intent.id,
            ruleId: preview.loyaltyRedemption.ruleId,
            points: preview.loyaltyRedemption.points,
            discountMinor: preview.loyaltyRedemption.discountMinor,
            currency: preview.currency,
          });
        }
        await transaction.orderIntentEvent.create({
          data: {
            orderIntentId: intent.id,
            actorUserId: userId,
            toStatus: 'OPEN',
            reason: 'CHECKOUT_PREVIEW_SNAPSHOTTED',
            correlationId,
          },
        });
        return transaction.orderIntent.findUniqueOrThrow({
          where: { id: intent.id },
          select: intentSelect,
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicate = await this.prisma.orderIntent.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey } },
          select: intentSelect,
        });
        if (duplicate) return this.expireIfDue(duplicate, userId);
      }
      throw error;
    }
  }

  async get(userId: string, intentId: string): Promise<IntentRecord> {
    const intent = await this.prisma.orderIntent.findFirst({
      where: { id: intentId, userId },
      select: intentSelect,
    });
    if (!intent) throw new NotFoundException('Order intent not found');
    return this.expireIfDue(intent, userId);
  }

  async cancel(userId: string, intentId: string, correlationId?: string): Promise<IntentRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const intent = await transaction.orderIntent.findFirst({ where: { id: intentId, userId } });
      if (!intent) throw new NotFoundException('Order intent not found');
      if (intent.status === 'CANCELLED') {
        return transaction.orderIntent.findUniqueOrThrow({
          where: { id: intentId },
          select: intentSelect,
        });
      }
      if (intent.status !== 'OPEN') {
        throw new ConflictException(
          `An intent in ${intent.status} cannot be cancelled by the customer`,
        );
      }
      const changed = await transaction.orderIntent.updateMany({
        where: { id: intentId, userId, status: 'OPEN', expiresAt: { gt: new Date() } },
        data: { status: 'CANCELLED' },
      });
      if (changed.count !== 1)
        throw new ConflictException('Intent changed or expired; retry the request');
      await transaction.orderIntentEvent.create({
        data: {
          orderIntentId: intentId,
          actorUserId: userId,
          fromStatus: intent.status,
          toStatus: 'CANCELLED',
          reason: 'CUSTOMER_CANCELLED',
          correlationId,
        },
      });
      await this.releaseCouponReservation(transaction, intentId);
      await releaseLoyaltyRedemption(transaction, intentId);
      return transaction.orderIntent.findUniqueOrThrow({
        where: { id: intentId },
        select: intentSelect,
      });
    });
  }

  private async expireIfDue(intent: IntentRecord, userId: string): Promise<IntentRecord> {
    if (!['OPEN', 'PAYMENT_PENDING'].includes(intent.status) || intent.expiresAt > new Date()) {
      return intent;
    }
    await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.orderIntent.updateMany({
        where: {
          id: intent.id,
          userId,
          status: { in: ['OPEN', 'PAYMENT_PENDING'] },
          expiresAt: { lte: new Date() },
        },
        data: { status: 'EXPIRED' },
      });
      if (changed.count !== 1) return;
      await transaction.orderIntentEvent.create({
        data: {
          orderIntentId: intent.id,
          fromStatus: intent.status,
          toStatus: 'EXPIRED',
          reason: 'PAYMENT_WINDOW_EXPIRED',
        },
      });
      await this.releaseCouponReservation(transaction, intent.id);
      await releaseLoyaltyRedemption(transaction, intent.id);
    });
    return this.prisma.orderIntent.findUniqueOrThrow({
      where: { id: intent.id },
      select: intentSelect,
    });
  }

  private async releaseCouponReservation(transaction: Prisma.TransactionClient, intentId: string) {
    const reservation = await transaction.couponRedemption.findUnique({
      where: { orderIntentId: intentId },
    });
    if (!reservation || reservation.status !== 'RESERVED') return;
    const released = await transaction.couponRedemption.updateMany({
      where: { id: reservation.id, status: 'RESERVED' },
      data: { status: 'RELEASED' },
    });
    if (released.count) {
      await transaction.coupon.updateMany({
        where: { id: reservation.couponId, usageCount: { gt: 0 } },
        data: { usageCount: { decrement: 1 } },
      });
    }
  }
}
