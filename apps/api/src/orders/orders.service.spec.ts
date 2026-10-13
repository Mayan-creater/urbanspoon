import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { RestaurantOrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { SandboxPaymentProvider } from './sandbox-payment.provider.js';

const attempt = {
  id: '20000000-0000-4000-8000-000000000001',
  orderIntentId: '10000000-0000-4000-8000-000000000001',
  provider: 'sandbox',
  providerReference: 'sandbox_20000000-0000-4000-8000-000000000001',
  amountMinor: 1350,
  currency: 'INR',
  status: 'PENDING',
  expiresAt: new Date(Date.now() + 60_000),
  orderIntent: {
    id: '10000000-0000-4000-8000-000000000001',
    userId: '30000000-0000-4000-8000-000000000001',
    restaurantId: '40000000-0000-4000-8000-000000000001',
    status: 'PAYMENT_PENDING',
    expiresAt: new Date(Date.now() + 60_000),
    checkoutSnapshot: { items: [{ menuItemId: '50000000-0000-4000-8000-000000000001' }] },
    currency: 'INR',
    subtotalMinor: 1000,
    discountMinor: 0,
    feesMinor: 100,
    taxMinor: 150,
    tipMinor: 100,
    totalMinor: 1350,
  },
  confirmingOrder: null,
};

function setupWebhook(overrides: Record<string, unknown> = {}) {
  const transaction = {
    paymentWebhookEvent: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'webhook-row' }),
      update: vi.fn().mockResolvedValue({}),
    },
    paymentAttempt: {
      findUnique: vi.fn().mockResolvedValue(attempt),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    paymentAttemptEvent: { create: vi.fn().mockResolvedValue({}) },
    orderIntent: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({}),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ ...attempt.orderIntent, status: 'CONFIRMED' }),
    },
    orderIntentEvent: { create: vi.fn().mockResolvedValue({}) },
    order: {
      create: vi.fn().mockResolvedValue({ id: 'order-id', status: 'CONFIRMED' }),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    orderStatusHistory: { create: vi.fn().mockResolvedValue({}) },
    couponRedemption: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    loyaltyRedemption: {
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    loyaltyTransaction: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockResolvedValue({}),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    refund: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'refund-id' }),
      update: vi.fn().mockResolvedValue({ id: 'refund-id', status: 'SUCCEEDED' }),
    },
    coupon: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    ...overrides,
  };
  const prisma = {
    $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
      operation(transaction),
    ),
    paymentAttempt: { findFirst: vi.fn().mockResolvedValue(attempt) },
    paymentWebhookEvent: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
  };
  const carts = { canConfirmSnapshot: vi.fn().mockResolvedValue(true) };
  const provider = new SandboxPaymentProvider();
  const service = new OrdersService(prisma as never, carts as never, provider, {} as never);
  const event = provider.createEvent(attempt, 'SUCCEEDED');
  return { transaction, prisma, carts, provider, service, event };
}

describe('OrdersService sandbox lifecycle', () => {
  it('creates a pending test attempt and returns it for an idempotent retry', async () => {
    process.env.NODE_ENV = 'test';
    const created = { ...attempt, status: 'PENDING' };
    const transaction = {
      orderIntent: {
        findFirst: vi.fn().mockResolvedValue({
          id: attempt.orderIntentId,
          userId: '30000000-0000-4000-8000-000000000001',
          status: 'OPEN',
          expiresAt: new Date(Date.now() + 60_000),
          totalMinor: attempt.amountMinor,
          currency: attempt.currency,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      paymentAttempt: {
        findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(created),
        create: vi.fn().mockResolvedValue({ ...created, status: 'INITIATED' }),
        update: vi.fn().mockResolvedValue(created),
      },
      paymentAttemptEvent: { create: vi.fn().mockResolvedValue({}) },
      orderIntentEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new OrdersService(
      prisma as never,
      {} as never,
      new SandboxPaymentProvider(),
      {} as never,
    );

    await expect(
      service.createAttempt(
        '30000000-0000-4000-8000-000000000001',
        attempt.orderIntentId,
        'attempt-request-key-0001',
      ),
    ).resolves.toMatchObject({ status: 'PENDING' });
    await expect(
      service.createAttempt(
        '30000000-0000-4000-8000-000000000001',
        attempt.orderIntentId,
        'attempt-request-key-0001',
      ),
    ).resolves.toMatchObject({ id: attempt.id });
    expect(transaction.paymentAttempt.create).toHaveBeenCalledOnce();
    expect(transaction.orderIntent.updateMany).toHaveBeenCalledOnce();
  });

  it('completes only a pending sandbox attempt owned by the signed-in customer', async () => {
    process.env.NODE_ENV = 'test';
    const { service, prisma, transaction } = setupWebhook();
    const userId = attempt.orderIntent.userId;

    const result = await service.completeSandboxIntent(userId, attempt.orderIntentId, {
      outcome: 'SUCCEEDED',
    });

    expect(prisma.paymentAttempt.findFirst).toHaveBeenCalledWith({
      where: {
        orderIntentId: attempt.orderIntentId,
        provider: 'sandbox',
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
    expect(result).toMatchObject({ intentStatus: 'CONFIRMED', order: { status: 'CONFIRMED' } });
    expect(transaction.order.create).toHaveBeenCalledOnce();
  });

  it('confirms exactly one order from the immutable snapshot after signed amount verification', async () => {
    process.env.NODE_ENV = 'test';
    const { service, provider, event, transaction, carts } = setupWebhook();

    const result = await service.receiveSandboxWebhook(event, provider.sign(event));

    expect(result).toMatchObject({ status: 'SUCCEEDED', intentStatus: 'CONFIRMED' });
    expect(carts.canConfirmSnapshot).toHaveBeenCalledOnce();
    expect(transaction.order.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderIntentId: attempt.orderIntentId,
        confirmingPaymentAttemptId: attempt.id,
        totalMinor: attempt.amountMinor,
        tipMinor: attempt.orderIntent.tipMinor,
        orderSnapshot: attempt.orderIntent.checkoutSnapshot,
      }),
    });
    expect(transaction.orderIntent.update).toHaveBeenCalledWith({
      where: { id: attempt.orderIntentId },
      data: { status: 'CONFIRMED' },
    });
    expect(transaction.orderStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ toStatus: 'CONFIRMED', reason: 'PAYMENT_CONFIRMED' }),
    });
  });

  it('consumes a reserved FoodCoins redemption exactly when payment confirms', async () => {
    process.env.NODE_ENV = 'test';
    const { service, provider, event, transaction } = setupWebhook({
      loyaltyRedemption: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'loyalty-redemption-id',
          userId: attempt.orderIntent.userId,
          ruleId: 'loyalty-rule-id',
          orderIntentId: attempt.orderIntentId,
          status: 'RESERVED',
          points: 100,
          discountMinor: 100,
          currency: 'INR',
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    });

    await service.receiveSandboxWebhook(event, provider.sign(event));

    expect(transaction.loyaltyRedemption.updateMany).toHaveBeenCalledWith({
      where: { id: 'loyalty-redemption-id', status: 'RESERVED' },
      data: { status: 'CONSUMED' },
    });
    expect(transaction.loyaltyTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-id',
        orderIntentId: attempt.orderIntentId,
        type: 'REDEMPTION',
        points: -100,
      }),
    });
  });

  it('restores consumed points in the same transaction as a customer cancellation refund', async () => {
    process.env.NODE_ENV = 'test';
    const order = {
      id: 'order-id',
      orderIntentId: attempt.orderIntentId,
      userId: attempt.orderIntent.userId,
      status: 'CONFIRMED',
      confirmingPaymentAttempt: {
        id: attempt.id,
        amountMinor: attempt.amountMinor,
        currency: attempt.currency,
      },
    };
    const transaction = {
      order: {
        findFirst: vi.fn().mockResolvedValue(order),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ ...order, status: 'CANCELLED_BY_CUSTOMER' }),
      },
      orderStatusHistory: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      refund: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'refund-id' }),
        update: vi.fn().mockResolvedValue({ id: 'refund-id', status: 'SUCCEEDED' }),
      },
      loyaltyRedemption: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'loyalty-redemption-id',
          userId: order.userId,
          ruleId: 'loyalty-rule-id',
          orderIntentId: order.orderIntentId,
          status: 'CONSUMED',
          points: 75,
          discountMinor: 75,
          currency: 'INR',
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      loyaltyTransaction: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'earned-points-id',
          userId: order.userId,
          ruleId: 'loyalty-rule-id',
          type: 'EARN',
          points: 40,
        }),
        upsert: vi.fn().mockResolvedValue({}),
      },
    };
    const delivery = { cancelForOrder: vi.fn().mockResolvedValue({}) };
    const prisma = {
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new OrdersService(
      prisma as never,
      {} as never,
      new SandboxPaymentProvider(),
      delivery as never,
    );

    await service.cancelCustomerOrder(order.userId, order.id);

    expect(transaction.loyaltyRedemption.updateMany).toHaveBeenCalledWith({
      where: { id: 'loyalty-redemption-id', status: 'CONSUMED' },
      data: { status: 'RESTORED' },
    });
    expect(transaction.loyaltyTransaction.upsert).toHaveBeenCalledWith({
      where: { idempotencyKey: 'refund:refund-id:loyalty:restore' },
      create: expect.objectContaining({
        orderId: 'order-id',
        type: 'REFUND_RESTORATION',
        points: 75,
      }),
      update: {},
    });
    expect(transaction.loyaltyTransaction.upsert).toHaveBeenCalledWith({
      where: { idempotencyKey: 'refund:refund-id:loyalty:reverse-earned' },
      create: expect.objectContaining({
        orderId: 'order-id',
        refundId: 'refund-id',
        type: 'REFUND_REVERSAL',
        points: -40,
      }),
      update: {},
    });
  });

  it('rejects a correctly signed webhook whose amount does not match the attempt', async () => {
    process.env.NODE_ENV = 'test';
    const { service, provider, event, transaction } = setupWebhook();
    const altered = { ...event, amountMinor: event.amountMinor + 1 };

    await expect(
      service.receiveSandboxWebhook(altered, provider.sign(altered)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction.order.create).not.toHaveBeenCalled();
    expect(transaction.paymentWebhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'webhook-row' },
      data: { processedAt: expect.any(Date), processingError: 'PAYMENT_DETAILS_MISMATCH' },
    });
  });

  it('persists invalid signatures and never enters the payment transaction', async () => {
    process.env.NODE_ENV = 'test';
    const { service, event, prisma } = setupWebhook();

    await expect(service.receiveSandboxWebhook(event, '0'.repeat(64))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.paymentWebhookEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'sandbox-invalid',
        signatureValid: false,
        processingError: 'INVALID_SIGNATURE',
      }),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('treats webhook retries with an already-recorded provider event id as idempotent', async () => {
    process.env.NODE_ENV = 'test';
    const existingEvent = { id: 'webhook-row', processedAt: new Date() };
    const { service, provider, event, transaction } = setupWebhook({
      paymentWebhookEvent: { findUnique: vi.fn().mockResolvedValue(existingEvent) },
    });

    await expect(service.receiveSandboxWebhook(event, provider.sign(event))).resolves.toEqual({
      duplicate: true,
    });
    expect(transaction.paymentAttempt.findUnique).not.toHaveBeenCalled();
  });

  it('serializes concurrent delivery of the same webhook event through the unique event key', async () => {
    process.env.NODE_ENV = 'test';
    const { service, provider, event, transaction, prisma } = setupWebhook();
    let eventRow: { id: string } | null = null;
    const uniqueViolation = new Prisma.PrismaClientKnownRequestError('duplicate event', {
      code: 'P2002',
      clientVersion: 'test',
    });
    transaction.paymentWebhookEvent.findUnique.mockImplementation(async () => eventRow);
    transaction.paymentWebhookEvent.create.mockImplementation(async () => {
      if (eventRow) throw uniqueViolation;
      eventRow = { id: 'webhook-row' };
      return eventRow;
    });
    prisma.paymentWebhookEvent.findUnique.mockImplementation(async () => eventRow);

    const signature = provider.sign(event);
    const results = await Promise.all([
      service.receiveSandboxWebhook(event, signature),
      service.receiveSandboxWebhook(event, signature),
    ]);

    expect(results).toContainEqual({ duplicate: true });
    expect(transaction.order.create).toHaveBeenCalledOnce();
  });

  it('refunds a second successful attempt when another attempt won order confirmation', async () => {
    process.env.NODE_ENV = 'test';
    const secondAttempt = {
      ...attempt,
      id: '20000000-0000-4000-8000-000000000002',
      providerReference: 'sandbox_second_attempt',
      orderIntent: { ...attempt.orderIntent, status: 'CONFIRMED' },
    };
    const { service, provider, transaction } = setupWebhook({
      paymentAttempt: {
        findUnique: vi.fn().mockResolvedValue(secondAttempt),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      orderIntent: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(secondAttempt.orderIntent),
      },
      order: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({
          id: 'first-order',
          orderIntentId: attempt.orderIntentId,
          confirmingPaymentAttemptId: attempt.id,
        }),
      },
    });
    const event = provider.createEvent(secondAttempt, 'SUCCEEDED');

    await expect(service.receiveSandboxWebhook(event, provider.sign(event))).resolves.toMatchObject(
      {
        intentStatus: 'CONFIRMED',
        refund: { status: 'SUCCEEDED' },
      },
    );
    expect(transaction.order.create).not.toHaveBeenCalled();
    expect(transaction.refund.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'first-order',
        orderIntentId: attempt.orderIntentId,
        paymentAttemptId: secondAttempt.id,
        reason: 'DUPLICATE_PAYMENT',
      }),
    });
  });

  it('refunds a late capture against the intent when cancellation left no order', async () => {
    process.env.NODE_ENV = 'test';
    const cancelledAttempt = {
      ...attempt,
      orderIntent: {
        ...attempt.orderIntent,
        status: 'CANCELLED',
        expiresAt: new Date(Date.now() - 60_000),
      },
    };
    const { service, provider, transaction } = setupWebhook({
      paymentAttempt: {
        findUnique: vi.fn().mockResolvedValue(cancelledAttempt),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      orderIntent: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(cancelledAttempt.orderIntent),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      order: { create: vi.fn(), findUnique: vi.fn().mockResolvedValue(null) },
    });
    const event = provider.createEvent(attempt, 'SUCCEEDED');

    await expect(service.receiveSandboxWebhook(event, provider.sign(event))).resolves.toMatchObject(
      {
        intentStatus: 'CANCELLED',
        refund: { status: 'SUCCEEDED' },
      },
    );
    expect(transaction.order.create).not.toHaveBeenCalled();
    expect(transaction.refund.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderIntentId: attempt.orderIntentId,
        paymentAttemptId: attempt.id,
        reason: 'LATE_PAYMENT',
      }),
    });
  });

  it('reopens an unexpired intent after a failed attempt so the customer can retry', async () => {
    process.env.NODE_ENV = 'test';
    const failedAttempt = { ...attempt, orderIntent: { ...attempt.orderIntent } };
    const transaction = {
      paymentWebhookEvent: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'webhook-row' }),
        update: vi.fn().mockResolvedValue({}),
      },
      paymentAttempt: {
        findUnique: vi.fn().mockResolvedValue(failedAttempt),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      paymentAttemptEvent: { create: vi.fn().mockResolvedValue({}) },
      orderIntent: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      orderIntentEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const provider = new SandboxPaymentProvider();
    const service = new OrdersService(prisma as never, {} as never, provider, {} as never);
    const event = provider.createEvent(attempt, 'FAILED');

    await expect(service.receiveSandboxWebhook(event, provider.sign(event))).resolves.toMatchObject(
      {
        status: 'FAILED',
        intentStatus: 'OPEN',
      },
    );
    expect(transaction.orderIntent.updateMany).toHaveBeenCalledWith({
      where: { id: attempt.orderIntentId, status: 'PAYMENT_PENDING' },
      data: { status: 'OPEN' },
    });
  });

  it('refunds a restaurant rejection and records the scoped actor transition', async () => {
    process.env.NODE_ENV = 'test';
    const order = {
      id: 'order-id',
      orderIntentId: attempt.orderIntentId,
      restaurantId: attempt.orderIntent.restaurantId,
      status: 'CONFIRMED',
      confirmingPaymentAttempt: {
        id: attempt.id,
        amountMinor: attempt.amountMinor,
        currency: attempt.currency,
      },
    };
    const transaction = {
      order: {
        findFirst: vi.fn().mockResolvedValue(order),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue({ ...order, status: 'REJECTED_BY_RESTAURANT' }),
      },
      orderStatusHistory: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      refund: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'refund-id' }),
        update: vi.fn().mockResolvedValue({ id: 'refund-id', status: 'SUCCEEDED' }),
      },
      loyaltyRedemption: { findUnique: vi.fn().mockResolvedValue(null) },
      loyaltyTransaction: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const prisma = {
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new OrdersService(
      prisma as never,
      {} as never,
      new SandboxPaymentProvider(),
      {} as never,
    );

    await service.transitionRestaurantOrder(
      'staff-user',
      order.restaurantId,
      order.id,
      'reject',
      'Item unavailable',
    );

    expect(transaction.order.updateMany).toHaveBeenCalledWith({
      where: { id: order.id, restaurantId: order.restaurantId, status: 'CONFIRMED' },
      data: { status: 'REJECTED_BY_RESTAURANT' },
    });
    expect(transaction.orderStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: 'staff-user',
        fromStatus: 'CONFIRMED',
        toStatus: 'REJECTED_BY_RESTAURANT',
        reason: 'Item unavailable',
      }),
    });
    expect(transaction.refund.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: order.id,
        amountMinor: attempt.amountMinor,
        reason: 'REJECTED_BY_RESTAURANT',
      }),
    });
  });

  it('creates a delivery in the same transaction when a restaurant accepts an order', async () => {
    const order = {
      id: 'order-id',
      orderIntentId: attempt.orderIntentId,
      restaurantId: attempt.orderIntent.restaurantId,
      status: 'CONFIRMED',
      confirmingPaymentAttempt: null,
    };
    const transaction = {
      order: {
        findFirst: vi.fn().mockResolvedValue(order),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ ...order, status: 'RESTAURANT_ACCEPTED' }),
      },
      orderStatusHistory: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const delivery = { createForAcceptedOrder: vi.fn().mockResolvedValue({ id: 'delivery-id' }) };
    const service = new OrdersService(
      prisma as never,
      {} as never,
      new SandboxPaymentProvider(),
      delivery as never,
    );

    await service.transitionRestaurantOrder(
      'restaurant-staff',
      order.restaurantId,
      order.id,
      'accept',
      undefined,
    );

    expect(delivery.createForAcceptedOrder).toHaveBeenCalledWith(
      transaction,
      order.id,
      'restaurant-staff',
      20,
    );
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(transaction.orderStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fromStatus: 'CONFIRMED', toStatus: 'RESTAURANT_ACCEPTED' }),
    });
  });

  it('includes restaurant names in customer order summaries for support and reviews', async () => {
    const prisma = {
      order: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new OrdersService(
      prisma as never,
      {} as never,
      new SandboxPaymentProvider(),
      {} as never,
    );

    await service.listCustomerOrders('customer-id');

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'customer-id' },
        include: expect.objectContaining({ restaurant: { select: { id: true, name: true } } }),
      }),
    );
  });

  it('declares restaurant-scoped permission on partner order operations', () => {
    const metadata = Reflect.getMetadata('permissionRequirement', RestaurantOrdersController);
    expect(metadata).toEqual({
      permission: 'restaurant.orders.manage',
      scopeType: 'RESTAURANT',
      scopeParam: 'restaurantId',
    });
  });
});
