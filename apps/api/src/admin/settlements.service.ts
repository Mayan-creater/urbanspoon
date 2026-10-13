import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, RestaurantSettlement } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import type {
  CreateCommissionRuleDto,
  GenerateSettlementDto,
  SettlementAdjustmentDto,
} from './settlements.dto.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PAGE_SIZE = 100;

@Injectable()
export class SettlementsService {
  constructor(private readonly prisma: PrismaService) {}

  list(status?: string, restaurantId?: string, page?: string, limit?: string) {
    const paging = this.pagination(page, limit);
    const where: Prisma.RestaurantSettlementWhereInput = {
      ...(status ? { status: this.settlementStatus(status) } : {}),
      ...(restaurantId ? { restaurantId } : {}),
    };
    return this.prisma.restaurantSettlement
      .findMany({
        where,
        include: {
          restaurant: { select: { id: true, name: true } },
          generatedBy: { select: { id: true, name: true } },
          approvedBy: { select: { id: true, name: true } },
          _count: { select: { items: true, adjustments: true } },
        },
        orderBy: [{ periodEnd: 'desc' }, { restaurantId: 'asc' }, { currency: 'asc' }],
        skip: paging.skip,
        take: paging.limit,
      })
      .then(async (items) => ({
        items,
        page: paging.page,
        limit: paging.limit,
        total: await this.prisma.restaurantSettlement.count({ where }),
      }));
  }

  commissionRules(restaurantId?: string) {
    return this.prisma.commissionRule.findMany({
      where: restaurantId === undefined ? {} : { restaurantId },
      include: { restaurant: { select: { id: true, name: true } } },
      orderBy: [{ ruleKey: 'asc' }, { version: 'desc' }],
    });
  }

  async createCommissionRule(
    actor: AuthenticatedUser,
    input: CreateCommissionRuleDto,
    correlationId?: string,
  ) {
    const effectiveFrom = new Date(input.effectiveFrom);
    const effectiveUntil = input.effectiveUntil ? new Date(input.effectiveUntil) : null;
    if (effectiveUntil && effectiveFrom >= effectiveUntil) {
      throw new BadRequestException('Commission rule end must be after its start.');
    }
    return this.prisma.$transaction(async (transaction) => {
      if (input.restaurantId) {
        const restaurant = await transaction.restaurant.findUnique({
          where: { id: input.restaurantId },
          select: { id: true },
        });
        if (!restaurant) throw new NotFoundException('Restaurant not found.');
      }
      const overlap = await transaction.commissionRule.findFirst({
        where: {
          ruleKey: input.ruleKey,
          restaurantId: input.restaurantId ?? null,
          isActive: true,
          effectiveFrom: { gte: effectiveFrom },
        },
      });
      if (overlap) throw new ConflictException('A later active commission version already exists.');
      const latest = await transaction.commissionRule.findFirst({
        where: { ruleKey: input.ruleKey },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const version = (latest?.version ?? 0) + 1;
      await transaction.commissionRule.updateMany({
        where: {
          ruleKey: input.ruleKey,
          restaurantId: input.restaurantId ?? null,
          isActive: true,
          effectiveFrom: { lt: effectiveFrom },
        },
        data: { effectiveUntil: effectiveFrom, isActive: false },
      });
      const rule = await transaction.commissionRule.create({
        data: {
          ruleKey: input.ruleKey,
          restaurantId: input.restaurantId,
          rateBps: input.rateBps,
          version,
          effectiveFrom,
          effectiveUntil,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: actor.id,
          permission: 'admin.pricing.manage',
          action: 'COMMISSION_RULE_VERSION_CREATED',
          entityType: 'commission_rule',
          entityId: rule.id,
          after: {
            ruleKey: rule.ruleKey,
            version: rule.version,
            restaurantId: rule.restaurantId,
            rateBps: rule.rateBps,
            effectiveFrom: rule.effectiveFrom.toISOString(),
            effectiveUntil: rule.effectiveUntil?.toISOString() ?? null,
          },
          correlationId,
        },
      });
      return rule;
    });
  }

  async generate(actor: AuthenticatedUser, input: GenerateSettlementDto, correlationId?: string) {
    const range = this.period(input.from, input.to);
    const existing = await this.prisma.restaurantSettlement.findMany({
      where: { restaurantId: input.restaurantId, periodStart: range.gte, periodEnd: range.lt },
      orderBy: { currency: 'asc' },
    });
    if (existing.length) return { items: existing, reused: true };

    const orders = await this.prisma.order.findMany({
      where: {
        restaurantId: input.restaurantId,
        status: 'DELIVERED',
        settlementItem: null,
        delivery: { is: { deliveredAt: range } },
      },
      include: {
        delivery: { select: { deliveredAt: true } },
        intent: { select: { coupon: { select: { restaurantId: true } } } },
        refunds: {
          where: { status: 'SUCCEEDED' },
          select: { restaurantAdjustmentMinor: true },
        },
      },
      orderBy: [{ delivery: { deliveredAt: 'asc' } }, { id: 'asc' }],
    });
    if (!orders.length) return { items: [], reused: false };

    const rules = await this.prisma.commissionRule.findMany({
      where: {
        effectiveFrom: { lt: range.lt },
        AND: [
          { OR: [{ restaurantId: input.restaurantId }, { restaurantId: null }] },
          {
            OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: range.gte } }],
          },
        ],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
    });
    const rows = orders.map((order) => {
      const deliveredAt = order.delivery?.deliveredAt;
      if (!deliveredAt)
        throw new ConflictException('Delivered order is missing its delivery timestamp.');
      const applicable = rules.filter(
        (rule) =>
          rule.effectiveFrom <= deliveredAt &&
          (!rule.effectiveUntil || deliveredAt < rule.effectiveUntil),
      );
      const rule =
        applicable.find((candidate) => candidate.restaurantId === input.restaurantId) ??
        applicable.find((candidate) => candidate.restaurantId === null);
      if (!rule)
        throw new ConflictException(`No commission rule is effective for order ${order.id}.`);
      const restaurantDiscountMinor =
        order.intent.coupon?.restaurantId === input.restaurantId ? order.discountMinor : 0;
      const refundAdjustmentMinor = order.refunds.reduce(
        (sum, refund) => sum + refund.restaurantAdjustmentMinor,
        0,
      );
      const commissionBasisMinor = Math.max(
        0,
        order.subtotalMinor - restaurantDiscountMinor - refundAdjustmentMinor,
      );
      const commissionMinor = Math.round((commissionBasisMinor * rule.rateBps) / 10000);
      return {
        order,
        rule,
        restaurantDiscountMinor,
        refundAdjustmentMinor,
        commissionBasisMinor,
        commissionMinor,
        netAmountMinor: commissionBasisMinor - commissionMinor,
      };
    });

    const byCurrency = new Map<string, typeof rows>();
    for (const row of rows) {
      const currencyRows = byCurrency.get(row.order.currency) ?? [];
      currencyRows.push(row);
      byCurrency.set(row.order.currency, currencyRows);
    }

    return this.prisma.$transaction(async (transaction) => {
      const concurrent = await transaction.restaurantSettlement.findMany({
        where: { restaurantId: input.restaurantId, periodStart: range.gte, periodEnd: range.lt },
        orderBy: { currency: 'asc' },
      });
      if (concurrent.length) return { items: concurrent, reused: true };
      const settlements: RestaurantSettlement[] = [];
      for (const [currency, currencyRows] of byCurrency) {
        const sum = (
          key:
            | 'order'
            | 'restaurantDiscountMinor'
            | 'refundAdjustmentMinor'
            | 'commissionBasisMinor'
            | 'commissionMinor'
            | 'netAmountMinor',
        ) =>
          currencyRows.reduce((total, row) => {
            if (key === 'order') return total + row.order.subtotalMinor;
            return total + row[key];
          }, 0);
        const settlement = await transaction.restaurantSettlement.create({
          data: {
            restaurantId: input.restaurantId,
            periodStart: range.gte,
            periodEnd: range.lt,
            currency,
            grossItemMinor: sum('order'),
            restaurantDiscountMinor: sum('restaurantDiscountMinor'),
            refundAdjustmentMinor: sum('refundAdjustmentMinor'),
            commissionBasisMinor: sum('commissionBasisMinor'),
            commissionMinor: sum('commissionMinor'),
            netAmountMinor: sum('netAmountMinor'),
            generatedByUserId: actor.id,
            items: {
              create: currencyRows.map((row) => ({
                orderId: row.order.id,
                commissionRuleId: row.rule.id,
                commissionRuleVersion: row.rule.version,
                grossItemMinor: row.order.subtotalMinor,
                restaurantDiscountMinor: row.restaurantDiscountMinor,
                refundAdjustmentMinor: row.refundAdjustmentMinor,
                commissionBasisMinor: row.commissionBasisMinor,
                commissionMinor: row.commissionMinor,
                netAmountMinor: row.netAmountMinor,
              })),
            },
          },
        });
        await transaction.auditLog.create({
          data: {
            actorUserId: actor.id,
            permission: 'admin.settlements.approve',
            action: 'RESTAURANT_SETTLEMENT_GENERATED',
            entityType: 'restaurant_settlement',
            entityId: settlement.id,
            after: {
              restaurantId: settlement.restaurantId,
              periodStart: settlement.periodStart.toISOString(),
              periodEnd: settlement.periodEnd.toISOString(),
              currency,
              itemCount: currencyRows.length,
              netAmountMinor: settlement.netAmountMinor,
            },
            correlationId,
          },
        });
        settlements.push(settlement);
      }
      return { items: settlements, reused: false };
    });
  }

  async adjust(
    actor: AuthenticatedUser,
    settlementId: string,
    input: SettlementAdjustmentDto,
    correlationId?: string,
  ) {
    const reason = input.reason.trim();
    if (!input.amountMinor || reason.length < 3) {
      throw new BadRequestException('A non-zero adjustment and reason are required.');
    }
    return this.prisma.$transaction(async (transaction) => {
      const settlement = await transaction.restaurantSettlement.findUnique({
        where: { id: settlementId },
      });
      if (!settlement) throw new NotFoundException('Settlement not found.');
      if (settlement.status !== 'DRAFT')
        throw new ConflictException('Only draft settlements can be adjusted.');
      if (settlement.netAmountMinor + input.amountMinor < 0) {
        throw new BadRequestException('Adjustment cannot make the settlement negative.');
      }
      const adjustment = await transaction.settlementAdjustment.create({
        data: {
          settlementId,
          actorUserId: actor.id,
          amountMinor: input.amountMinor,
          currency: settlement.currency,
          reason,
        },
      });
      await transaction.restaurantSettlement.update({
        where: { id: settlementId },
        data: { netAmountMinor: { increment: input.amountMinor } },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: actor.id,
          permission: 'admin.settlements.approve',
          action: 'RESTAURANT_SETTLEMENT_ADJUSTED',
          entityType: 'restaurant_settlement',
          entityId: settlementId,
          before: { netAmountMinor: settlement.netAmountMinor },
          after: {
            netAmountMinor: settlement.netAmountMinor + input.amountMinor,
            amountMinor: input.amountMinor,
            reason,
          },
          correlationId,
        },
      });
      return adjustment;
    });
  }

  async approve(actor: AuthenticatedUser, settlementId: string, correlationId?: string) {
    return this.prisma.$transaction(async (transaction) => {
      const settlement = await transaction.restaurantSettlement.findUnique({
        where: { id: settlementId },
      });
      if (!settlement) throw new NotFoundException('Settlement not found.');
      if (settlement.generatedByUserId === actor.id) {
        throw new ConflictException('The settlement generator cannot approve the same settlement.');
      }
      if (settlement.status !== 'DRAFT')
        throw new ConflictException('Only draft settlements can be approved.');
      const approvedAt = new Date();
      const updated = await transaction.restaurantSettlement.updateMany({
        where: { id: settlementId, status: 'DRAFT' },
        data: { status: 'APPROVED', approvedByUserId: actor.id, approvedAt },
      });
      if (!updated.count) throw new ConflictException('Settlement changed; refresh and retry.');
      await transaction.auditLog.create({
        data: {
          actorUserId: actor.id,
          permission: 'admin.settlements.approve',
          action: 'RESTAURANT_SETTLEMENT_APPROVED',
          entityType: 'restaurant_settlement',
          entityId: settlementId,
          before: { status: 'DRAFT' },
          after: { status: 'APPROVED', approvedAt: approvedAt.toISOString() },
          correlationId,
        },
      });
      return transaction.restaurantSettlement.findUniqueOrThrow({ where: { id: settlementId } });
    });
  }

  async markPaid(
    actor: AuthenticatedUser,
    settlementId: string,
    externalTransferReference: string,
    correlationId?: string,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const settlement = await transaction.restaurantSettlement.findUnique({
        where: { id: settlementId },
      });
      if (!settlement) throw new NotFoundException('Settlement not found.');
      if (settlement.status !== 'APPROVED') {
        throw new ConflictException('Only approved settlements can be reconciled as paid.');
      }
      const paidAt = new Date();
      const updated = await transaction.restaurantSettlement.updateMany({
        where: { id: settlementId, status: 'APPROVED' },
        data: { status: 'PAID', paidAt, externalTransferReference },
      });
      if (!updated.count) throw new ConflictException('Settlement changed; refresh and retry.');
      await transaction.auditLog.create({
        data: {
          actorUserId: actor.id,
          permission: 'admin.settlements.approve',
          action: 'RESTAURANT_SETTLEMENT_EXTERNALLY_RECONCILED',
          entityType: 'restaurant_settlement',
          entityId: settlementId,
          before: { status: 'APPROVED' },
          after: { status: 'PAID', paidAt: paidAt.toISOString(), externalTransferReference },
          correlationId,
        },
      });
      return transaction.restaurantSettlement.findUniqueOrThrow({ where: { id: settlementId } });
    });
  }

  private period(from: string, to: string) {
    const start = new Date(from);
    const end = new Date(to);
    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      start >= end ||
      end > new Date() ||
      end.getTime() - start.getTime() > 366 * DAY_MS
    ) {
      throw new BadRequestException('Use a past date range of at most 366 days; to is exclusive.');
    }
    return { gte: start, lt: end };
  }

  private pagination(page?: string, limit?: string) {
    const parsedPage = page === undefined ? 1 : Number(page);
    const parsedLimit = limit === undefined ? 50 : Number(limit);
    if (
      !Number.isInteger(parsedPage) ||
      parsedPage < 1 ||
      !Number.isInteger(parsedLimit) ||
      parsedLimit < 1 ||
      parsedLimit > MAX_PAGE_SIZE
    ) {
      throw new BadRequestException(
        `page must be positive and limit must be between 1 and ${MAX_PAGE_SIZE}.`,
      );
    }
    return { page: parsedPage, limit: parsedLimit, skip: (parsedPage - 1) * parsedLimit };
  }

  private settlementStatus(value: string) {
    const status = value.toUpperCase();
    if (status !== 'DRAFT' && status !== 'APPROVED' && status !== 'PAID') {
      throw new BadRequestException('Invalid settlement status.');
    }
    return status;
  }
}
