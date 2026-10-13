import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import type { RequestRefundDto } from './admin.dto.js';

interface AdminListQuery {
  status?: string;
  from?: string;
  to?: string;
  page?: string;
  limit?: string;
}

interface AdminAuditQuery extends AdminListQuery {
  action?: string;
  entityType?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_REPORT_DAYS = 366;
const MAX_PAGE_SIZE = 100;

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async requestRefund(
    actor: AuthenticatedUser,
    input: RequestRefundDto,
    idempotencyKey: string | undefined,
    correlationId?: string,
  ) {
    if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
      throw new BadRequestException('A 16-128 character Idempotency-Key header is required.');
    }
    const reason = input.reason.trim();
    const existing = await this.prisma.refund.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (
        existing.paymentAttemptId !== input.paymentAttemptId ||
        existing.amountMinor !== input.amountMinor ||
        existing.reason !== reason ||
        existing.restaurantAdjustmentMinor !== (input.restaurantAdjustmentMinor ?? 0)
      ) {
        throw new ConflictException('Idempotency key was already used for a different refund.');
      }
      return existing;
    }
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "PaymentAttempt" WHERE "id" = ${input.paymentAttemptId}::uuid FOR UPDATE`,
      );
      const attempt = await transaction.paymentAttempt.findUnique({
        where: { id: input.paymentAttemptId },
        include: { orderIntent: { select: { id: true, order: { select: { id: true } } } } },
      });
      if (!attempt) throw new NotFoundException('Payment attempt not found.');
      if (attempt.status !== 'SUCCEEDED') {
        throw new ConflictException('Only a succeeded payment can be manually refunded.');
      }
      const alreadyRefunded = await transaction.refund.aggregate({
        where: {
          paymentAttemptId: attempt.id,
          status: { in: ['REQUESTED', 'SUBMITTED', 'SUCCEEDED'] },
        },
        _sum: { amountMinor: true },
      });
      if ((alreadyRefunded._sum.amountMinor ?? 0) + input.amountMinor > attempt.amountMinor) {
        throw new BadRequestException(
          'Requested refunds cannot exceed the captured payment amount.',
        );
      }
      const restaurantAdjustmentMinor = input.restaurantAdjustmentMinor ?? 0;
      if (restaurantAdjustmentMinor > input.amountMinor) {
        throw new BadRequestException(
          'Restaurant refund adjustment cannot exceed the refund amount.',
        );
      }
      const refund = await transaction.refund.create({
        data: {
          orderId: attempt.orderIntent.order?.id,
          orderIntentId: attempt.orderIntent.id,
          paymentAttemptId: attempt.id,
          requestedByUserId: actor.id,
          status: 'REQUESTED',
          amountMinor: input.amountMinor,
          restaurantAdjustmentMinor,
          currency: attempt.currency,
          reason,
          idempotencyKey,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: actor.id,
          permission: 'payment.refund',
          action: 'MANUAL_REFUND_REQUESTED',
          entityType: 'refund',
          entityId: refund.id,
          after: {
            paymentAttemptId: attempt.id,
            amountMinor: refund.amountMinor,
            restaurantAdjustmentMinor,
            currency: refund.currency,
            reason,
          },
          correlationId,
        },
      });
      return refund;
    });
  }

  async approveRefund(actor: AuthenticatedUser, refundId: string, correlationId?: string) {
    return this.transitionRequestedRefund(actor, refundId, 'SUBMITTED', undefined, correlationId);
  }

  async rejectRefund(
    actor: AuthenticatedUser,
    refundId: string,
    reason: string,
    correlationId?: string,
  ) {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 3)
      throw new BadRequestException('A rejection reason is required.');
    return this.transitionRequestedRefund(
      actor,
      refundId,
      'REJECTED',
      normalizedReason,
      correlationId,
    );
  }

  async retryRefund(actor: AuthenticatedUser, refundId: string, correlationId?: string) {
    return this.prisma.$transaction(async (transaction) => {
      const refund = await transaction.refund.findUnique({ where: { id: refundId } });
      if (!refund) throw new NotFoundException('Refund not found.');
      if (refund.status !== 'FAILED')
        throw new ConflictException('Only failed refunds can be retried.');
      const updated = await transaction.refund.updateMany({
        where: { id: refundId, status: 'FAILED' },
        data: { status: 'SUBMITTED' },
      });
      if (!updated.count) throw new ConflictException('Refund changed; refresh and retry.');
      await transaction.auditLog.create({
        data: {
          actorUserId: actor.id,
          permission: 'payment.refund',
          action: 'REFUND_RETRY_QUEUED',
          entityType: 'refund',
          entityId: refund.id,
          before: { status: 'FAILED' },
          after: { status: 'SUBMITTED', idempotencyKey: refund.idempotencyKey },
          correlationId,
        },
      });
      return transaction.refund.findUniqueOrThrow({ where: { id: refundId } });
    });
  }

  private async transitionRequestedRefund(
    actor: AuthenticatedUser,
    refundId: string,
    status: 'SUBMITTED' | 'REJECTED',
    reason?: string,
    correlationId?: string,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const refund = await transaction.refund.findUnique({ where: { id: refundId } });
      if (!refund) throw new NotFoundException('Refund not found.');
      if (refund.status !== 'REQUESTED') {
        throw new ConflictException('Only requested refunds can be approved or rejected.');
      }
      if (refund.requestedByUserId === actor.id) {
        throw new ConflictException(
          'A refund requester cannot approve or reject their own request.',
        );
      }
      const updated = await transaction.refund.updateMany({
        where: { id: refundId, status: 'REQUESTED' },
        data: { status, ...(reason ? { reason: `${refund.reason} | Rejected: ${reason}` } : {}) },
      });
      if (!updated.count) throw new ConflictException('Refund changed; refresh and retry.');
      await transaction.auditLog.create({
        data: {
          actorUserId: actor.id,
          permission: 'payment.refund.approve',
          action: status === 'SUBMITTED' ? 'MANUAL_REFUND_APPROVED' : 'MANUAL_REFUND_REJECTED',
          entityType: 'refund',
          entityId: refund.id,
          before: { status: 'REQUESTED' },
          after: { status, reason: reason ?? null },
          correlationId,
        },
      });
      return transaction.refund.findUniqueOrThrow({ where: { id: refundId } });
    });
  }

  async dashboard(from?: string, to?: string) {
    const range = this.dateRange(from, to);
    const where = { createdAt: range };
    const [orderCount, deliveredOrders, payments, refunds, userCount, restaurantCount] =
      await Promise.all([
        this.prisma.order.count({ where }),
        this.prisma.order.groupBy({
          by: ['currency'],
          where: { ...where, status: 'DELIVERED' },
          _count: { _all: true },
          _sum: { subtotalMinor: true },
        }),
        this.prisma.paymentAttempt.groupBy({
          by: ['status', 'currency'],
          where,
          _count: { _all: true },
          _sum: { amountMinor: true },
        }),
        this.prisma.refund.groupBy({
          by: ['status', 'currency'],
          where,
          _count: { _all: true },
          _sum: { amountMinor: true },
        }),
        this.prisma.user.count({ where: { createdAt: range } }),
        this.prisma.restaurant.count({ where: { createdAt: range } }),
      ]);
    return {
      range: { from: range.gte.toISOString(), to: range.lt.toISOString() },
      orders: { count: orderCount, delivered: deliveredOrders },
      payments,
      refunds,
      newUsers: userCount,
      newRestaurants: restaurantCount,
    };
  }

  async reports(from?: string, to?: string) {
    const range = this.dateRange(from, to);
    const [ordersByStatusAndCurrency, paymentsByStatusAndCurrency, refundsByStatusAndCurrency] =
      await Promise.all([
        this.prisma.order.groupBy({
          by: ['status', 'currency'],
          where: { createdAt: range },
          _count: { _all: true },
          _sum: {
            subtotalMinor: true,
            discountMinor: true,
            feesMinor: true,
            taxMinor: true,
            tipMinor: true,
            totalMinor: true,
          },
        }),
        this.prisma.paymentAttempt.groupBy({
          by: ['status', 'currency'],
          where: { createdAt: range },
          _count: { _all: true },
          _sum: { amountMinor: true },
        }),
        this.prisma.refund.groupBy({
          by: ['status', 'currency'],
          where: { createdAt: range },
          _count: { _all: true },
          _sum: { amountMinor: true },
        }),
      ]);
    return {
      range: { from: range.gte.toISOString(), to: range.lt.toISOString() },
      ordersByStatusAndCurrency,
      paymentsByStatusAndCurrency,
      refundsByStatusAndCurrency,
    };
  }

  async reportsCsv(from?: string, to?: string) {
    const report = await this.reports(from, to);
    const header = [
      'record_type',
      'status',
      'currency',
      'count',
      'subtotal_minor',
      'discount_minor',
      'fees_minor',
      'tax_minor',
      'tip_minor',
      'total_minor',
      'amount_minor',
    ];
    const rows = [
      header,
      ...report.ordersByStatusAndCurrency.map((row) => [
        'order',
        row.status,
        row.currency,
        row._count._all,
        row._sum.subtotalMinor ?? 0,
        row._sum.discountMinor ?? 0,
        row._sum.feesMinor ?? 0,
        row._sum.taxMinor ?? 0,
        row._sum.tipMinor ?? 0,
        row._sum.totalMinor ?? 0,
        '',
      ]),
      ...report.paymentsByStatusAndCurrency.map((row) => [
        'payment',
        row.status,
        row.currency,
        row._count._all,
        '',
        '',
        '',
        '',
        '',
        '',
        row._sum.amountMinor ?? 0,
      ]),
      ...report.refundsByStatusAndCurrency.map((row) => [
        'refund',
        row.status,
        row.currency,
        row._count._all,
        '',
        '',
        '',
        '',
        '',
        '',
        row._sum.amountMinor ?? 0,
      ]),
    ];
    return (
      rows.map((row) => row.map((value) => this.csvCell(value)).join(',')).join('\r\n') + '\r\n'
    );
  }

  async users(search?: string, page?: string, limit?: string) {
    const pagination = this.pagination(page, limit);
    const normalizedSearch = search?.trim();
    const where: Prisma.UserWhereInput = normalizedSearch
      ? {
          OR: [
            { name: { contains: normalizedSearch, mode: 'insensitive' } },
            { email: { contains: normalizedSearch, mode: 'insensitive' } },
            { phone: { contains: normalizedSearch } },
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          status: true,
          createdAt: true,
          roles: {
            where: { status: 'ACTIVE' },
            select: { id: true, role: true, scopeType: true, scopeId: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, page: pagination.page, limit: pagination.limit, total };
  }

  async updateUserStatus(
    actor: AuthenticatedUser,
    userId: string,
    status: 'ACTIVE' | 'SUSPENDED' | 'DISABLED',
    reason: string,
    correlationId?: string,
  ) {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 3)
      throw new BadRequestException('A status-change reason is required.');
    if (actor.id === userId && status !== 'ACTIVE') {
      throw new ConflictException('Administrators cannot suspend or disable their own account.');
    }
    return this.prisma.$transaction(async (transaction) => {
      const user = await transaction.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          status: true,
          roles: {
            where: { status: 'ACTIVE', role: 'super_admin', scopeType: 'PLATFORM' },
            select: { id: true },
          },
        },
      });
      if (!user) throw new NotFoundException('User not found.');
      if (user.status === status) return user;
      if (status !== 'ACTIVE' && user.roles.length) {
        const otherActiveSuperAdmins = await transaction.userRole.count({
          where: {
            userId: { not: userId },
            user: { status: 'ACTIVE' },
            role: 'super_admin',
            scopeType: 'PLATFORM',
            status: 'ACTIVE',
          },
        });
        if (otherActiveSuperAdmins === 0) {
          throw new ConflictException(
            'The last active super-admin cannot be suspended or disabled.',
          );
        }
      }
      const changed = await transaction.user.updateMany({
        where: { id: userId, status: user.status },
        data: { status },
      });
      if (!changed.count) throw new ConflictException('User status changed; refresh and retry.');
      if (status !== 'ACTIVE') {
        await transaction.authSession.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await transaction.auditLog.create({
        data: {
          actorUserId: actor.id,
          permission: 'admin.users.manage',
          action: 'USER_STATUS_CHANGED',
          entityType: 'user',
          entityId: userId,
          before: { status: user.status },
          after: { status, reason: normalizedReason },
          correlationId,
        },
      });
      return transaction.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, name: true, email: true, status: true, updatedAt: true },
      });
    });
  }

  async orders(query: AdminListQuery) {
    const pagination = this.pagination(query.page, query.limit);
    const range = this.dateRange(query.from, query.to);
    const where: Prisma.OrderWhereInput = {
      createdAt: range,
      ...(query.status
        ? { status: this.enumValue(query.status, orderStatuses, 'order status') }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        select: {
          id: true,
          status: true,
          currency: true,
          subtotalMinor: true,
          discountMinor: true,
          feesMinor: true,
          taxMinor: true,
          tipMinor: true,
          totalMinor: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true } },
          restaurant: { select: { id: true, name: true } },
          refunds: { select: { id: true, status: true, amountMinor: true, currency: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items, page: pagination.page, limit: pagination.limit, total };
  }

  async paymentAttempts(query: AdminListQuery) {
    const pagination = this.pagination(query.page, query.limit);
    const range = this.dateRange(query.from, query.to);
    const where: Prisma.PaymentAttemptWhereInput = {
      createdAt: range,
      ...(query.status
        ? { status: this.enumValue(query.status, paymentStatuses, 'payment status') }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.paymentAttempt.findMany({
        where,
        select: {
          id: true,
          provider: true,
          providerReference: true,
          status: true,
          amountMinor: true,
          currency: true,
          failureCode: true,
          createdAt: true,
          orderIntent: {
            select: {
              id: true,
              user: { select: { id: true, name: true, email: true } },
              order: { select: { id: true, status: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      this.prisma.paymentAttempt.count({ where }),
    ]);
    return { items, page: pagination.page, limit: pagination.limit, total };
  }

  async refunds(query: AdminListQuery) {
    const pagination = this.pagination(query.page, query.limit);
    const range = this.dateRange(query.from, query.to);
    const where: Prisma.RefundWhereInput = {
      createdAt: range,
      ...(query.status
        ? { status: this.enumValue(query.status, refundStatuses, 'refund status') }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.refund.findMany({
        where,
        select: {
          id: true,
          status: true,
          amountMinor: true,
          currency: true,
          reason: true,
          providerReference: true,
          createdAt: true,
          order: { select: { id: true, status: true } },
          paymentAttempt: { select: { id: true, provider: true, status: true } },
          requestedBy: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      this.prisma.refund.count({ where }),
    ]);
    return { items, page: pagination.page, limit: pagination.limit, total };
  }

  async auditLogs(actorUserId: string, query: AdminAuditQuery) {
    const pagination = this.pagination(query.page, query.limit);
    const range = this.dateRange(query.from, query.to);
    const where = {
      createdAt: range,
      ...(query.action?.trim()
        ? { action: { contains: query.action.trim(), mode: 'insensitive' as const } }
        : {}),
      ...(query.entityType?.trim() ? { entityType: query.entityType.trim() } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        select: {
          id: true,
          actorUserId: true,
          permission: true,
          action: true,
          entityType: true,
          entityId: true,
          before: true,
          after: true,
          correlationId: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        permission: 'admin.audit.read',
        action: 'AUDIT_LOGS_VIEWED',
        entityType: 'audit_log_query',
        entityId: 'collection',
        after: {
          filters: { action: query.action, entityType: query.entityType },
          page: pagination.page,
        },
      },
    });
    return { items, page: pagination.page, limit: pagination.limit, total };
  }

  private dateRange(from?: string, to?: string) {
    const end = to ? new Date(to) : new Date();
    const start = from ? new Date(from) : new Date(end.getTime() - 30 * DAY_MS);
    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      start >= end ||
      end > new Date(Date.now() + 60_000) ||
      end.getTime() - start.getTime() > MAX_REPORT_DAYS * DAY_MS
    ) {
      throw new BadRequestException('Use a valid date range of at most 366 days; to is exclusive.');
    }
    return { gte: start, lt: end };
  }

  private csvCell(value: string | number) {
    const text = String(value);
    const safe = /^[=+@-]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
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

  private enumValue<T extends string>(value: string, values: readonly T[], label: string): T {
    const normalized = value.toUpperCase();
    const matched = values.find((candidate) => candidate === normalized);
    if (!matched) throw new BadRequestException(`Invalid ${label}.`);
    return matched;
  }
}

const orderStatuses = [
  'CONFIRMED',
  'RESTAURANT_ACCEPTED',
  'REJECTED_BY_RESTAURANT',
  'PREPARING',
  'READY_FOR_PICKUP',
  'PICKED_UP',
  'DELIVERED',
  'DELIVERY_FAILED',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_RESTAURANT',
  'CANCELLED_BY_ADMIN',
] as const;
const paymentStatuses = ['INITIATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED'] as const;
const refundStatuses = ['REQUESTED', 'SUBMITTED', 'SUCCEEDED', 'FAILED', 'REJECTED'] as const;
