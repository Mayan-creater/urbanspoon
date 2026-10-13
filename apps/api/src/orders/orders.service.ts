import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import { CartsService } from '../carts/carts.service.js';
import { DeliveryService } from '../delivery/delivery.service.js';
import {
  consumeLoyaltyRedemption,
  releaseLoyaltyRedemption,
  reverseEarnedLoyalty,
  restoreLoyaltyRedemption,
} from '../loyalty/loyalty-ledger.js';
import type { SandboxPaymentCompletionDto, SandboxPaymentWebhookDto } from './order-intents.dto.js';
import { SandboxPaymentProvider } from './sandbox-payment.provider.js';

const attemptInclude = {
  orderIntent: true,
  confirmingOrder: { select: { id: true, status: true } },
} satisfies Prisma.PaymentAttemptInclude;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly carts: CartsService,
    private readonly provider: SandboxPaymentProvider,
    private readonly delivery: DeliveryService,
  ) {}

  async createAttempt(userId: string, intentId: string, idempotencyKey: string | undefined) {
    this.provider.assertAvailable();
    if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
      throw new BadRequestException('A 16-128 character Idempotency-Key header is required');
    }
    const providerKey = createHash('sha256').update(`${intentId}\0${idempotencyKey}`).digest('hex');
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const intent = await transaction.orderIntent.findFirst({ where: { id: intentId, userId } });
        if (!intent) throw new NotFoundException('Order intent not found');
        const existing = await transaction.paymentAttempt.findUnique({
          where: {
            provider_idempotencyKey: { provider: this.provider.name, idempotencyKey: providerKey },
          },
        });
        if (existing) return existing;
        const now = new Date();
        if (intent.status !== 'OPEN' || intent.expiresAt <= now) {
          throw new ConflictException('Order intent is not available for a payment attempt');
        }

        const attempt = await transaction.paymentAttempt.create({
          data: {
            orderIntentId: intent.id,
            provider: this.provider.name,
            idempotencyKey: providerKey,
            status: 'INITIATED',
            amountMinor: intent.totalMinor,
            currency: intent.currency,
            expiresAt: intent.expiresAt,
          },
        });
        await transaction.paymentAttemptEvent.create({
          data: { paymentAttemptId: attempt.id, toStatus: 'INITIATED', reason: 'ATTEMPT_CREATED' },
        });
        const session = this.provider.createSession(attempt.id);
        const pendingAttempt = await transaction.paymentAttempt.update({
          where: { id: attempt.id },
          data: {
            status: 'PENDING',
            providerReference: session.providerReference,
            checkoutUrl: session.checkoutUrl,
            providerData: { mode: 'test' },
          },
        });
        await transaction.paymentAttemptEvent.create({
          data: {
            paymentAttemptId: attempt.id,
            fromStatus: 'INITIATED',
            toStatus: 'PENDING',
            reason: 'SANDBOX_SESSION_CREATED',
          },
        });
        const changed = await transaction.orderIntent.updateMany({
          where: { id: intent.id, userId, status: 'OPEN', expiresAt: { gt: now } },
          data: { status: 'PAYMENT_PENDING' },
        });
        if (changed.count !== 1) {
          throw new ConflictException('Order intent changed while creating the payment attempt');
        }
        await transaction.orderIntentEvent.create({
          data: {
            orderIntentId: intent.id,
            actorUserId: userId,
            fromStatus: 'OPEN',
            toStatus: 'PAYMENT_PENDING',
            reason: 'PAYMENT_ATTEMPT_CREATED',
          },
        });
        return pendingAttempt;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicate = await this.prisma.paymentAttempt.findUnique({
          where: {
            provider_idempotencyKey: { provider: this.provider.name, idempotencyKey: providerKey },
          },
        });
        if (duplicate) return duplicate;
      }
      throw error;
    }
  }

  async getAttempt(userId: string, attemptId: string) {
    const attempt = await this.prisma.paymentAttempt.findFirst({
      where: { id: attemptId, orderIntent: { userId } },
      include: { events: { orderBy: { createdAt: 'asc' } } },
    });
    if (!attempt) throw new NotFoundException('Payment attempt not found');
    return attempt;
  }

  async verifyAttempt(userId: string, attemptId: string) {
    return this.getAttempt(userId, attemptId);
  }

  async completeSandboxAttempt(attemptId: string, input: SandboxPaymentCompletionDto) {
    this.provider.assertTestMode();
    const attempt = await this.prisma.paymentAttempt.findFirst({
      where: { id: attemptId, provider: this.provider.name },
      select: {
        id: true,
        orderIntentId: true,
        providerReference: true,
        amountMinor: true,
        currency: true,
      },
    });
    if (!attempt) throw new NotFoundException('Sandbox payment attempt not found');
    const event = this.provider.createEvent(attempt, input.outcome);
    return this.receiveSandboxWebhook(event, this.provider.sign(event));
  }

  async completeSandboxIntent(
    userId: string,
    intentId: string,
    input: SandboxPaymentCompletionDto,
  ) {
    this.provider.assertAvailable();
    const attempt = await this.prisma.paymentAttempt.findFirst({
      where: {
        orderIntentId: intentId,
        provider: this.provider.name,
        status: 'PENDING',
        orderIntent: { userId },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        orderIntentId: true,
        providerReference: true,
        amountMinor: true,
        currency: true,
      },
    });
    if (!attempt) throw new NotFoundException('Pending sandbox payment attempt not found');
    const event = this.provider.createEvent(attempt, input.outcome);
    return this.processSandboxWebhook(event, this.provider.sign(event));
  }

  async receiveSandboxWebhook(event: SandboxPaymentWebhookDto, signature: string | undefined) {
    this.provider.assertTestMode();
    return this.processSandboxWebhook(event, signature);
  }

  private async processSandboxWebhook(event: SandboxPaymentWebhookDto, signature: string | undefined) {
    this.provider.assertAvailable();
    if (!this.provider.verify(event, signature)) {
      try {
        await this.prisma.paymentWebhookEvent.create({
          data: {
            provider: `${this.provider.name}-invalid`,
            providerEventId: event.providerEventId,
            signatureValid: false,
            payload: event as unknown as Prisma.InputJsonValue,
            processedAt: new Date(),
            processingError: 'INVALID_SIGNATURE',
          },
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
          throw error;
        }
      }
      throw new UnauthorizedException('Payment webhook signature is invalid');
    }

    let result: { duplicate?: boolean; error?: string; value?: unknown };
    try {
      result = await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.paymentWebhookEvent.findUnique({
          where: {
            provider_providerEventId: {
              provider: this.provider.name,
              providerEventId: event.providerEventId,
            },
          },
        });
        if (existing) return { duplicate: true, value: existing };
        const webhook = await transaction.paymentWebhookEvent.create({
          data: {
            provider: this.provider.name,
            providerEventId: event.providerEventId,
            signatureValid: true,
            payload: event as unknown as Prisma.InputJsonValue,
          },
        });
        const attempt = await transaction.paymentAttempt.findUnique({
          where: { id: event.paymentAttemptId },
          include: attemptInclude,
        });
        if (!attempt || attempt.provider !== this.provider.name) {
          await transaction.paymentWebhookEvent.update({
            where: { id: webhook.id },
            data: { processedAt: new Date(), processingError: 'ATTEMPT_NOT_FOUND' },
          });
          return { error: 'Payment attempt not found' };
        }
        if (
          attempt.orderIntentId !== event.orderIntentId ||
          attempt.providerReference !== event.providerReference ||
          attempt.amountMinor !== event.amountMinor ||
          attempt.currency !== event.currency
        ) {
          await transaction.paymentWebhookEvent.update({
            where: { id: webhook.id },
            data: { processedAt: new Date(), processingError: 'PAYMENT_DETAILS_MISMATCH' },
          });
          return { error: 'Payment does not match the recorded attempt' };
        }

        const value =
          event.type === 'PAYMENT_SUCCEEDED'
            ? await this.applySuccessfulPayment(transaction, attempt, event)
            : await this.applyFailedPayment(transaction, attempt, event);
        await transaction.paymentWebhookEvent.update({
          where: { id: webhook.id },
          data: { processedAt: new Date() },
        });
        return { value };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicate = await this.prisma.paymentWebhookEvent.findUnique({
          where: {
            provider_providerEventId: {
              provider: this.provider.name,
              providerEventId: event.providerEventId,
            },
          },
        });
        if (duplicate) return { duplicate: true };
      }
      throw error;
    }
    if (result.error) throw new BadRequestException(result.error);
    return result.duplicate ? { duplicate: true } : result.value;
  }

  async listCustomerOrders(userId: string) {
    return this.prisma.order.findMany({
      where: { userId },
      include: {
        restaurant: { select: { id: true, name: true } },
        statusHistory: { orderBy: { createdAt: 'asc' } },
        refunds: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getCustomerOrder(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: {
        statusHistory: { orderBy: { createdAt: 'asc' } },
        refunds: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async cancelCustomerOrder(userId: string, orderId: string, correlationId?: string) {
    return this.prisma.$transaction(async (transaction) => {
      const order = await transaction.order.findFirst({
        where: { id: orderId, userId },
        include: { confirmingPaymentAttempt: true },
      });
      if (!order) throw new NotFoundException('Order not found');
      if (order.status !== 'CONFIRMED') {
        throw new ConflictException(
          'Customer cancellation is allowed only before restaurant acceptance',
        );
      }
      const changed = await transaction.order.updateMany({
        where: { id: order.id, status: 'CONFIRMED' },
        data: { status: 'CANCELLED_BY_CUSTOMER' },
      });
      if (!changed.count) throw new ConflictException('Order changed; retry the request');
      await transaction.orderStatusHistory.create({
        data: {
          orderId: order.id,
          actorUserId: userId,
          fromStatus: 'CONFIRMED',
          toStatus: 'CANCELLED_BY_CUSTOMER',
          reason: 'CUSTOMER_CANCELLED_BEFORE_ACCEPTANCE',
          correlationId,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: userId,
          permission: 'orders.self.manage',
          action: 'ORDER_CANCELLED_BY_CUSTOMER',
          entityType: 'order',
          entityId: order.id,
          before: { status: 'CONFIRMED' },
          after: { status: 'CANCELLED_BY_CUSTOMER' },
          correlationId,
        },
      });
      if (order.confirmingPaymentAttempt) {
        await this.createAutomaticRefund(
          transaction,
          order.orderIntentId,
          order.id,
          order.confirmingPaymentAttempt,
          'CUSTOMER_CANCELLED',
        );
      }
      await this.delivery.cancelForOrder(
        transaction,
        order.id,
        userId,
        'ORDER_CANCELLED_BY_CUSTOMER',
      );
      return transaction.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { statusHistory: true, refunds: true },
      });
    });
  }

  async cancelAdminOrder(userId: string, orderId: string, reason: string, correlationId?: string) {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 3)
      throw new BadRequestException('A cancellation reason is required.');
    return this.prisma.$transaction(async (transaction) => {
      const order = await transaction.order.findUnique({
        where: { id: orderId },
        include: { confirmingPaymentAttempt: true },
      });
      if (!order) throw new NotFoundException('Order not found.');
      const cancellableStatuses = [
        'CONFIRMED',
        'RESTAURANT_ACCEPTED',
        'PREPARING',
        'READY_FOR_PICKUP',
      ] as const;
      if (!cancellableStatuses.includes(order.status as (typeof cancellableStatuses)[number])) {
        throw new ConflictException(
          `An order in ${order.status} cannot be cancelled by an administrator.`,
        );
      }
      const previousStatus = order.status;
      const changed = await transaction.order.updateMany({
        where: { id: order.id, status: previousStatus },
        data: { status: 'CANCELLED_BY_ADMIN' },
      });
      if (!changed.count) throw new ConflictException('Order changed; refresh and retry.');
      await transaction.orderStatusHistory.create({
        data: {
          orderId: order.id,
          actorUserId: userId,
          fromStatus: previousStatus,
          toStatus: 'CANCELLED_BY_ADMIN',
          reason: normalizedReason,
          correlationId,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: userId,
          permission: 'admin.orders.manage',
          action: 'ORDER_CANCELLED_BY_ADMIN',
          entityType: 'order',
          entityId: order.id,
          before: { status: previousStatus },
          after: { status: 'CANCELLED_BY_ADMIN', reason: normalizedReason },
          correlationId,
        },
      });
      if (order.confirmingPaymentAttempt) {
        await this.createAutomaticRefund(
          transaction,
          order.orderIntentId,
          order.id,
          order.confirmingPaymentAttempt,
          'ADMIN_CANCELLED',
        );
      }
      await this.delivery.cancelForOrder(transaction, order.id, userId, normalizedReason);
      return transaction.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { statusHistory: { orderBy: { createdAt: 'asc' } }, refunds: true },
      });
    });
  }

  async listRestaurantOrders(restaurantId: string) {
    return this.prisma.order.findMany({
      where: { restaurantId },
      include: { statusHistory: { orderBy: { createdAt: 'asc' } }, refunds: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getRestaurantOrder(restaurantId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, restaurantId },
      include: { statusHistory: { orderBy: { createdAt: 'asc' } }, refunds: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async transitionRestaurantOrder(
    userId: string,
    restaurantId: string,
    orderId: string,
    action: 'accept' | 'reject' | 'preparing' | 'ready' | 'cancel',
    reason: string | undefined,
    correlationId?: string,
    prepTimeMinutes?: number,
  ) {
    const transitions = {
      accept: { from: ['CONFIRMED'], to: 'RESTAURANT_ACCEPTED' },
      reject: { from: ['CONFIRMED'], to: 'REJECTED_BY_RESTAURANT' },
      preparing: { from: ['RESTAURANT_ACCEPTED'], to: 'PREPARING' },
      ready: { from: ['PREPARING'], to: 'READY_FOR_PICKUP' },
      cancel: {
        from: ['RESTAURANT_ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP'],
        to: 'CANCELLED_BY_RESTAURANT',
      },
    } as const;
    if ((action === 'reject' || action === 'cancel') && !reason?.trim()) {
      throw new BadRequestException('A reason is required for this order transition');
    }
    const transition = transitions[action];
    return this.prisma.$transaction(async (transaction) => {
      const order = await transaction.order.findFirst({
        where: { id: orderId, restaurantId },
        include: { confirmingPaymentAttempt: true },
      });
      if (!order) throw new NotFoundException('Order not found');
      if (!(transition.from as readonly string[]).includes(order.status)) {
        throw new ConflictException(`Order in ${order.status} cannot ${action}`);
      }
      const fromStatus = order.status;
      const toStatus = transition.to;
      const changed = await transaction.order.updateMany({
        where: { id: order.id, restaurantId, status: fromStatus },
        data: { status: toStatus },
      });
      if (!changed.count) throw new ConflictException('Order changed; retry the request');
      await transaction.orderStatusHistory.create({
        data: {
          orderId: order.id,
          actorUserId: userId,
          fromStatus,
          toStatus,
          reason: reason?.trim() || action.toUpperCase(),
          correlationId,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: userId,
          permission: 'restaurant.orders.manage',
          action: `ORDER_${action.toUpperCase()}`,
          entityType: 'order',
          entityId: order.id,
          before: { status: fromStatus },
          after: { status: toStatus, reason: reason?.trim() ?? null },
          correlationId,
        },
      });
      if (toStatus === 'RESTAURANT_ACCEPTED') {
        await this.delivery.createForAcceptedOrder(
          transaction,
          order.id,
          userId,
          prepTimeMinutes ?? 20,
        );
      }
      if (
        (toStatus === 'REJECTED_BY_RESTAURANT' || toStatus === 'CANCELLED_BY_RESTAURANT') &&
        order.confirmingPaymentAttempt
      ) {
        await this.createAutomaticRefund(
          transaction,
          order.orderIntentId,
          order.id,
          order.confirmingPaymentAttempt,
          toStatus,
        );
      }
      if (toStatus === 'CANCELLED_BY_RESTAURANT') {
        await this.delivery.cancelForOrder(transaction, order.id, userId, reason!.trim());
      }
      return transaction.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { statusHistory: { orderBy: { createdAt: 'asc' } }, refunds: true },
      });
    });
  }

  private async applyFailedPayment(
    transaction: Prisma.TransactionClient,
    attempt: Prisma.PaymentAttemptGetPayload<{ include: typeof attemptInclude }>,
    event: SandboxPaymentWebhookDto,
  ) {
    if (attempt.status === 'SUCCEEDED') return { attemptId: attempt.id, status: attempt.status };
    if (attempt.status === 'FAILED' || attempt.status === 'CANCELLED') {
      return { attemptId: attempt.id, status: attempt.status };
    }
    const changed = await transaction.paymentAttempt.updateMany({
      where: { id: attempt.id, status: { in: ['INITIATED', 'PENDING'] } },
      data: { status: 'FAILED', failureCode: event.failureCode ?? 'PAYMENT_FAILED' },
    });
    if (!changed.count) return { attemptId: attempt.id, status: 'FAILED' };
    await transaction.paymentAttemptEvent.create({
      data: {
        paymentAttemptId: attempt.id,
        fromStatus: attempt.status,
        toStatus: 'FAILED',
        reason: event.failureCode ?? 'PAYMENT_FAILED',
        providerEventId: event.providerEventId,
      },
    });
    const now = new Date();
    const nextIntentStatus = attempt.orderIntent.expiresAt <= now ? 'EXPIRED' : 'OPEN';
    const intentChanged = await transaction.orderIntent.updateMany({
      where: { id: attempt.orderIntentId, status: 'PAYMENT_PENDING' },
      data: { status: nextIntentStatus },
    });
    if (intentChanged.count) {
      await transaction.orderIntentEvent.create({
        data: {
          orderIntentId: attempt.orderIntentId,
          fromStatus: 'PAYMENT_PENDING',
          toStatus: nextIntentStatus,
          reason: nextIntentStatus === 'OPEN' ? 'PAYMENT_ATTEMPT_FAILED' : 'PAYMENT_WINDOW_EXPIRED',
        },
      });
      if (nextIntentStatus === 'EXPIRED') {
        await this.releaseCouponReservation(transaction, attempt.orderIntentId);
      }
    }
    return { attemptId: attempt.id, status: 'FAILED', intentStatus: nextIntentStatus };
  }

  private async applySuccessfulPayment(
    transaction: Prisma.TransactionClient,
    initialAttempt: Prisma.PaymentAttemptGetPayload<{ include: typeof attemptInclude }>,
    event: SandboxPaymentWebhookDto,
  ) {
    if (initialAttempt.status === 'SUCCEEDED') {
      return { attemptId: initialAttempt.id, status: 'SUCCEEDED', duplicate: true };
    }
    const changedAttempt = await transaction.paymentAttempt.updateMany({
      where: {
        id: initialAttempt.id,
        status: { in: ['INITIATED', 'PENDING', 'FAILED', 'CANCELLED'] },
      },
      data: { status: 'SUCCEEDED', verifiedAt: new Date(), failureCode: null },
    });
    if (!changedAttempt.count) {
      const current = await transaction.paymentAttempt.findUniqueOrThrow({
        where: { id: initialAttempt.id },
      });
      return { attemptId: current.id, status: current.status, duplicate: true };
    }
    await transaction.paymentAttemptEvent.create({
      data: {
        paymentAttemptId: initialAttempt.id,
        fromStatus: initialAttempt.status,
        toStatus: 'SUCCEEDED',
        reason: initialAttempt.status === 'FAILED' ? 'PROVIDER_LATE_CAPTURE' : 'PAYMENT_VERIFIED',
        providerEventId: event.providerEventId,
      },
    });

    const now = new Date();
    let intentStatus = initialAttempt.orderIntent.status;
    const eligible =
      intentStatus === 'PAYMENT_PENDING' && initialAttempt.orderIntent.expiresAt > now;
    const claimed = eligible
      ? await transaction.orderIntent.updateMany({
          where: {
            id: initialAttempt.orderIntentId,
            status: 'PAYMENT_PENDING',
            expiresAt: { gt: now },
          },
          data: { status: 'PAYMENT_VERIFIED' },
        })
      : { count: 0 };

    if (claimed.count) {
      await transaction.orderIntentEvent.create({
        data: {
          orderIntentId: initialAttempt.orderIntentId,
          fromStatus: 'PAYMENT_PENDING',
          toStatus: 'PAYMENT_VERIFIED',
          reason: 'SIGNED_SANDBOX_PAYMENT_VERIFIED',
        },
      });
      const canConfirm = await this.carts.canConfirmSnapshot(
        transaction,
        initialAttempt.orderIntent.restaurantId,
        initialAttempt.orderIntent.checkoutSnapshot,
        now,
      );
      if (canConfirm) {
        const order = await transaction.order.create({
          data: {
            orderIntentId: initialAttempt.orderIntentId,
            userId: initialAttempt.orderIntent.userId,
            restaurantId: initialAttempt.orderIntent.restaurantId,
            confirmingPaymentAttemptId: initialAttempt.id,
            status: 'CONFIRMED',
            currency: initialAttempt.orderIntent.currency,
            subtotalMinor: initialAttempt.orderIntent.subtotalMinor,
            discountMinor: initialAttempt.orderIntent.discountMinor,
            feesMinor: initialAttempt.orderIntent.feesMinor,
            taxMinor: initialAttempt.orderIntent.taxMinor,
            tipMinor: initialAttempt.orderIntent.tipMinor,
            totalMinor: initialAttempt.orderIntent.totalMinor,
            orderSnapshot: initialAttempt.orderIntent.checkoutSnapshot as Prisma.InputJsonValue,
          },
        });
        await transaction.orderStatusHistory.create({
          data: { orderId: order.id, toStatus: 'CONFIRMED', reason: 'PAYMENT_CONFIRMED' },
        });
        await transaction.orderIntent.update({
          where: { id: initialAttempt.orderIntentId },
          data: { status: 'CONFIRMED' },
        });
        await transaction.orderIntentEvent.create({
          data: {
            orderIntentId: initialAttempt.orderIntentId,
            fromStatus: 'PAYMENT_VERIFIED',
            toStatus: 'CONFIRMED',
            reason: 'ORDER_CREATED',
          },
        });
        await transaction.couponRedemption.updateMany({
          where: { orderIntentId: initialAttempt.orderIntentId, status: 'RESERVED' },
          data: { status: 'CONSUMED' },
        });
        await consumeLoyaltyRedemption(transaction, order.id, initialAttempt.orderIntentId);
        await transaction.auditLog.create({
          data: {
            permission: 'system.payment.confirm',
            action: 'ORDER_CONFIRMED_FROM_VERIFIED_PAYMENT',
            entityType: 'order',
            entityId: order.id,
            after: {
              orderIntentId: initialAttempt.orderIntentId,
              paymentAttemptId: initialAttempt.id,
            },
          },
        });
        return {
          attemptId: initialAttempt.id,
          status: 'SUCCEEDED',
          intentStatus: 'CONFIRMED',
          order,
        };
      }

      await transaction.orderIntent.update({
        where: { id: initialAttempt.orderIntentId },
        data: { status: 'VOIDED' },
      });
      await transaction.orderIntentEvent.create({
        data: {
          orderIntentId: initialAttempt.orderIntentId,
          fromStatus: 'PAYMENT_VERIFIED',
          toStatus: 'VOIDED',
          reason: 'ORDER_CONFIRMATION_REVALIDATION_FAILED',
        },
      });
      await this.releaseCouponReservation(transaction, initialAttempt.orderIntentId);
      const refund = await this.createAutomaticRefund(
        transaction,
        initialAttempt.orderIntentId,
        null,
        initialAttempt,
        'INTENT_VOIDED',
      );
      return { attemptId: initialAttempt.id, status: 'SUCCEEDED', intentStatus: 'VOIDED', refund };
    }

    const intent = await transaction.orderIntent.findUniqueOrThrow({
      where: { id: initialAttempt.orderIntentId },
    });
    intentStatus = intent.status;
    if (intentStatus === 'PAYMENT_PENDING' && intent.expiresAt <= now) {
      const expired = await transaction.orderIntent.updateMany({
        where: { id: intent.id, status: 'PAYMENT_PENDING', expiresAt: { lte: now } },
        data: { status: 'EXPIRED' },
      });
      if (expired.count) {
        await transaction.orderIntentEvent.create({
          data: {
            orderIntentId: intent.id,
            fromStatus: 'PAYMENT_PENDING',
            toStatus: 'EXPIRED',
            reason: 'PAYMENT_WINDOW_EXPIRED',
          },
        });
        await this.releaseCouponReservation(transaction, intent.id);
      }
      intentStatus = 'EXPIRED';
    }
    const existingOrder = await transaction.order.findUnique({
      where: { orderIntentId: intent.id },
    });
    if (existingOrder?.confirmingPaymentAttemptId === initialAttempt.id) {
      return {
        attemptId: initialAttempt.id,
        status: 'SUCCEEDED',
        intentStatus,
        order: existingOrder,
      };
    }
    const reason = ['CONFIRMED', 'VOIDED', 'PAYMENT_VERIFIED'].includes(intentStatus)
      ? 'DUPLICATE_PAYMENT'
      : 'LATE_PAYMENT';
    const refund = await this.createAutomaticRefund(
      transaction,
      intent.id,
      existingOrder?.id ?? null,
      initialAttempt,
      reason,
    );
    return { attemptId: initialAttempt.id, status: 'SUCCEEDED', intentStatus, refund };
  }

  private async createAutomaticRefund(
    transaction: Prisma.TransactionClient,
    intentId: string,
    orderId: string | null,
    attempt: { id: string; amountMinor: number; currency: string },
    reason: string,
  ) {
    const idempotencyKey = `sandbox:auto:${attempt.id}:${reason}`;
    const existing = await transaction.refund.findUnique({ where: { idempotencyKey } });
    if (existing) return existing;
    const refund = await transaction.refund.create({
      data: {
        orderId: orderId ?? undefined,
        orderIntentId: intentId,
        paymentAttemptId: attempt.id,
        amountMinor: attempt.amountMinor,
        currency: attempt.currency,
        reason,
        idempotencyKey,
        status: 'SUBMITTED',
      },
    });
    const providerResult = this.provider.executeRefund(idempotencyKey);
    const completed = await transaction.refund.update({
      where: { id: refund.id },
      data: { status: 'SUCCEEDED', providerReference: providerResult.providerReference },
    });
    await transaction.auditLog.create({
      data: {
        permission: 'system.payment.refund',
        action: 'AUTOMATIC_SANDBOX_REFUND_SUCCEEDED',
        entityType: 'refund',
        entityId: completed.id,
        after: { orderId, orderIntentId: intentId, amountMinor: attempt.amountMinor, reason },
      },
    });
    if (orderId) {
      await reverseEarnedLoyalty(transaction, orderId, intentId, completed.id);
      await restoreLoyaltyRedemption(transaction, orderId, intentId, completed.id);
    }
    return completed;
  }

  private async releaseCouponReservation(transaction: Prisma.TransactionClient, intentId: string) {
    const reservation = await transaction.couponRedemption.findUnique({
      where: { orderIntentId: intentId },
    });
    if (reservation?.status === 'RESERVED') {
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
    await releaseLoyaltyRedemption(transaction, intentId);
  }
}
