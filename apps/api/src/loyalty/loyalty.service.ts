import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import type { CreateLoyaltyRuleDto } from './loyalty.dto.js';
import { loyaltyTier } from './loyalty-calculation.js';
import { availableLoyaltyPoints } from './loyalty-ledger.js';

@Injectable()
export class LoyaltyService {
  constructor(private readonly prisma: PrismaService) {}

  wallet(userId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const [balancePoints, lifetime, entries] = await Promise.all([
        availableLoyaltyPoints(transaction, userId, new Date()),
        transaction.loyaltyTransaction.aggregate({
          where: { userId, type: { in: ['EARN', 'REFUND_REVERSAL'] } },
          _sum: { points: true },
        }),
        transaction.loyaltyTransaction.findMany({
          where: { userId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 50,
          include: {
            rule: { select: { currency: true, version: true } },
            order: { select: { id: true } },
          },
        }),
      ]);
      const lifetimeEarnedPoints = lifetime._sum.points ?? 0;
      return {
        balancePoints,
        lifetimeEarnedPoints,
        tier: loyaltyTier(lifetimeEarnedPoints),
        transactions: entries,
      };
    });
  }

  listRules() {
    return this.prisma.loyaltyRule.findMany({ orderBy: [{ currency: 'asc' }, { version: 'desc' }] });
  }

  async createRule(actorUserId: string, input: CreateLoyaltyRuleDto) {
    const effectiveFrom = new Date(input.effectiveFrom);
    const effectiveUntil = input.effectiveUntil ? new Date(input.effectiveUntil) : null;
    if (!Number.isFinite(effectiveFrom.getTime())) {
      throw new BadRequestException('Loyalty rule start date is invalid');
    }
    if (effectiveUntil && effectiveUntil <= effectiveFrom) {
      throw new BadRequestException('Loyalty rule end must be after its start');
    }

    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${'loyalty:' + input.currency}))`,
      );
      const latest = await transaction.loyaltyRule.findFirst({
        where: { currency: input.currency },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const rule = await transaction.loyaltyRule.create({
        data: {
          currency: input.currency,
          version: (latest?.version ?? 0) + 1,
          earnRateBps: input.earnRateBps,
          redeemMinorPerPoint: input.redeemMinorPerPoint ?? 1,
          pointsExpireAfterDays: input.pointsExpireAfterDays ?? 365,
          effectiveFrom,
          effectiveUntil,
          createdByUserId: actorUserId,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId,
          permission: 'admin.loyalty.manage',
          action: 'LOYALTY_EARNING_RULE_CREATED',
          entityType: 'loyalty_rule',
          entityId: rule.id,
          after: {
            currency: rule.currency,
            version: rule.version,
            earnRateBps: rule.earnRateBps,
            redeemMinorPerPoint: rule.redeemMinorPerPoint,
            pointsExpireAfterDays: rule.pointsExpireAfterDays,
            effectiveFrom: rule.effectiveFrom.toISOString(),
            effectiveUntil: rule.effectiveUntil?.toISOString() ?? null,
          },
        },
      });
      return rule;
    });
  }

  async disableRule(actorUserId: string, ruleId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const rule = await transaction.loyaltyRule.findUnique({ where: { id: ruleId } });
      if (!rule) throw new NotFoundException('Loyalty rule not found');
      if (!rule.isActive) return rule;

      const disabled = await transaction.loyaltyRule.update({
        where: { id: ruleId },
        data: { isActive: false },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId,
          permission: 'admin.loyalty.manage',
          action: 'LOYALTY_EARNING_RULE_DISABLED',
          entityType: 'loyalty_rule',
          entityId: ruleId,
          before: { isActive: rule.isActive },
          after: { isActive: disabled.isActive, currency: rule.currency, version: rule.version },
        },
      });
      return disabled;
    });
  }
}