import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { OrderIntentsService } from './order-intents.service.js';

describe('OrderIntentsService', () => {
  it('stores the server checkout preview and returns the same intent for an idempotent retry', async () => {
    const preview = {
      cartId: 'cart-id',
      restaurant: { id: 'restaurant-id', name: 'Test Kitchen' },
      address: null,
      currency: 'INR',
      items: [{ menuItemId: 'item-id', name: 'Bowl', quantity: 2, unitPriceMinor: 1000 }],
      subtotalMinor: 2000,
      coupon: null,
      discountMinor: 0,
      feesMinor: 50,
      taxMinor: 100,
      tipMinor: 200,
      totalMinor: 2350,
      charges: [{ type: 'ITEM_SUBTOTAL', amountMinor: 2000 }],
      pricingRuleVersions: [{ ruleKey: 'tax', ruleId: 'tax-rule', version: 2 }],
      expiresAt: '2026-10-08T10:00:00.000Z',
    };
    const intent = {
      id: 'intent-id',
      userId: 'user-id',
      restaurantId: 'restaurant-id',
      idempotencyKey: 'checkout-request-0001',
      status: 'OPEN',
      currency: 'INR',
      subtotalMinor: 2000,
      discountMinor: 0,
      feesMinor: 50,
      taxMinor: 100,
      tipMinor: 200,
      totalMinor: 2350,
      checkoutSnapshot: preview,
      expiresAt: new Date(Date.now() + 900_000),
      paymentAttempts: [],
      events: [],
    };
    const transaction = {
      orderIntent: {
        create: vi.fn().mockResolvedValue(intent),
        findUniqueOrThrow: vi.fn().mockResolvedValue(intent),
      },
      orderIntentEvent: { create: vi.fn().mockResolvedValue({}) },
      coupon: { findUnique: vi.fn() },
    };
    const prisma = {
      orderIntent: {
        findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(intent),
      },
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const carts = { preview: vi.fn().mockResolvedValue(preview) };
    const service = new OrderIntentsService(prisma as never, carts as never);
    const input = { cartId: 'cart-id', tipBasisPoints: 1000 as const };

    await expect(service.create('user-id', input, 'checkout-request-0001')).resolves.toMatchObject({
      id: 'intent-id',
      status: 'OPEN',
      checkoutSnapshot: preview,
      tipMinor: 200,
      totalMinor: 2350,
    });
    await expect(service.create('user-id', input, 'checkout-request-0001')).resolves.toMatchObject({
      id: 'intent-id',
    });
    expect(carts.preview).toHaveBeenCalledOnce();
    expect(transaction.orderIntent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tipMinor: 200, totalMinor: 2350 }),
    });
    expect(transaction.orderIntentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ toStatus: 'OPEN', reason: 'CHECKOUT_PREVIEW_SNAPSHOTTED' }),
      }),
    );
  });

  it('requires an idempotency key before calculating a checkout preview', async () => {
    const prisma = { orderIntent: { findUnique: vi.fn() } };
    const carts = { preview: vi.fn() };
    const service = new OrderIntentsService(prisma as never, carts as never);

    await expect(
      service.create('user-id', { cartId: 'cart-id' }, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(carts.preview).not.toHaveBeenCalled();
  });

  it('reserves coupon usage in the same transaction as intent creation', async () => {
    const preview = {
      restaurant: { id: 'restaurant-id', name: 'Test Kitchen' },
      currency: 'INR',
      subtotalMinor: 2000,
      discountMinor: 200,
      feesMinor: 50,
      taxMinor: 100,
      totalMinor: 1950,
      coupon: { code: 'SAVE10', discountMinor: 200 },
    };
    const transaction = {
      coupon: {
        findUnique: vi.fn().mockResolvedValue({ id: 'coupon-id', code: 'SAVE10', usageLimit: 1 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      orderIntent: {
        create: vi.fn().mockResolvedValue({ id: 'intent-id' }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'intent-id' }),
      },
      couponRedemption: { create: vi.fn().mockResolvedValue({}) },
      orderIntentEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      orderIntent: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const carts = { preview: vi.fn().mockResolvedValue(preview) };
    const service = new OrderIntentsService(prisma as never, carts as never);

    await service.create(
      'user-id',
      { cartId: 'cart-id', couponCode: 'SAVE10' },
      'checkout-request-0002',
    );

    expect(transaction.coupon.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'coupon-id',
          OR: [{ usageLimit: null }, { usageCount: { lt: 1 } }],
        }),
        data: { usageCount: { increment: 1 } },
      }),
    );
    expect(transaction.couponRedemption.create).toHaveBeenCalledWith({
      data: { couponId: 'coupon-id', orderIntentId: 'intent-id', status: 'RESERVED' },
    });
  });

  it('locks the customer balance and reserves the quoted FoodCoins redemption atomically', async () => {
    const preview = {
      restaurant: { id: 'restaurant-id', name: 'Test Kitchen' },
      currency: 'INR',
      subtotalMinor: 2000,
      discountMinor: 100,
      feesMinor: 50,
      taxMinor: 100,
      totalMinor: 2050,
      coupon: null,
      loyaltyRedemption: {
        points: 100,
        discountMinor: 100,
        ruleId: 'rule-id',
        ruleVersion: 2,
      },
    };
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      loyaltyRule: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'rule-id',
          version: 2,
          redeemMinorPerPoint: 1,
        }),
      },
      loyaltyTransaction: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { points: 150 } }),
      },
      loyaltyRedemption: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { points: 50 } }),
        create: vi.fn().mockResolvedValue({}),
      },
      coupon: { findUnique: vi.fn() },
      orderIntent: {
        create: vi.fn().mockResolvedValue({ id: 'intent-id' }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'intent-id' }),
      },
      orderIntentEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      orderIntent: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const carts = { preview: vi.fn().mockResolvedValue(preview) };
    const service = new OrderIntentsService(prisma as never, carts as never);

    await service.create(
      'user-id',
      { cartId: 'cart-id', loyaltyPoints: 100 },
      'checkout-request-0003',
    );

    expect(transaction.$queryRaw).toHaveBeenCalledOnce();
    expect(transaction.loyaltyRedemption.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-id',
        orderIntentId: 'intent-id',
        ruleId: 'rule-id',
        points: 100,
        discountMinor: 100,
        currency: 'INR',
        status: 'RESERVED',
      },
    });
  });

  it('serializes first-order campaign reservation and rejects an existing customer order', async () => {
    const transaction = {
      coupon: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'coupon-id',
          code: 'WELCOME',
          usageLimit: null,
          perUserLimit: 1,
          firstOrderOnly: true,
        }),
        updateMany: vi.fn(),
      },
      order: { count: vi.fn().mockResolvedValue(1) },
      couponRedemption: { findFirst: vi.fn().mockResolvedValue(null) },
      orderIntent: { create: vi.fn() },
      orderIntentEvent: { create: vi.fn() },
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    const prisma = {
      orderIntent: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const carts = {
      preview: vi.fn().mockResolvedValue({
        restaurant: { id: 'restaurant-id', name: 'Test Kitchen' },
        currency: 'INR',
        coupon: { code: 'WELCOME', discountMinor: 100 },
      }),
    };
    const service = new OrderIntentsService(prisma as never, carts as never);

    await expect(
      service.create('user-id', { cartId: 'cart-id', couponCode: 'WELCOME' }, 'campaign-key-001'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction.$queryRaw).toHaveBeenCalledOnce();
    expect(transaction.coupon.updateMany).not.toHaveBeenCalled();
  });

  it('enforces per-customer campaign limits again while reserving the order intent', async () => {
    const transaction = {
      coupon: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'coupon-id',
          code: 'SAVE10',
          usageLimit: null,
          perUserLimit: 1,
          firstOrderOnly: false,
        }),
        updateMany: vi.fn(),
      },
      couponRedemption: { count: vi.fn().mockResolvedValue(1) },
      orderIntent: { create: vi.fn() },
      orderIntentEvent: { create: vi.fn() },
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    const prisma = {
      orderIntent: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const carts = {
      preview: vi.fn().mockResolvedValue({
        restaurant: { id: 'restaurant-id', name: 'Test Kitchen' },
        currency: 'INR',
        coupon: { code: 'SAVE10', discountMinor: 100 },
      }),
    };
    const service = new OrderIntentsService(prisma as never, carts as never);

    await expect(
      service.create('user-id', { cartId: 'cart-id', couponCode: 'SAVE10' }, 'campaign-key-002'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction.$queryRaw).toHaveBeenCalledOnce();
    expect(transaction.coupon.updateMany).not.toHaveBeenCalled();
  });

  it('cancels an open intent and releases reserved coupon usage once', async () => {
    const intent = { id: 'intent-id', userId: 'user-id', status: 'OPEN' };
    const transaction = {
      orderIntent: {
        findFirst: vi.fn().mockResolvedValue(intent),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ ...intent, status: 'CANCELLED' }),
      },
      orderIntentEvent: { create: vi.fn().mockResolvedValue({}) },
      couponRedemption: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'redemption-id', couponId: 'coupon-id', status: 'RESERVED' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      coupon: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      loyaltyRedemption: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new OrderIntentsService(prisma as never, {} as never);

    await expect(service.cancel('user-id', 'intent-id')).resolves.toMatchObject({
      status: 'CANCELLED',
    });
    expect(transaction.couponRedemption.updateMany).toHaveBeenCalledWith({
      where: { id: 'redemption-id', status: 'RESERVED' },
      data: { status: 'RELEASED' },
    });
    expect(transaction.coupon.updateMany).toHaveBeenCalledWith({
      where: { id: 'coupon-id', usageCount: { gt: 0 } },
      data: { usageCount: { decrement: 1 } },
    });
  });

  it('expires an overdue open intent and releases its coupon reservation', async () => {
    const overdue = {
      id: 'intent-id',
      userId: 'user-id',
      status: 'OPEN',
      expiresAt: new Date(Date.now() - 1000),
    };
    const transaction = {
      orderIntent: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      orderIntentEvent: { create: vi.fn().mockResolvedValue({}) },
      couponRedemption: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'redemption-id', couponId: 'coupon-id', status: 'RESERVED' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      coupon: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      loyaltyRedemption: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const expired = { ...overdue, status: 'EXPIRED' };
    const prisma = {
      orderIntent: {
        findFirst: vi.fn().mockResolvedValue(overdue),
        findUniqueOrThrow: vi.fn().mockResolvedValue(expired),
      },
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new OrderIntentsService(prisma as never, {} as never);

    await expect(service.get('user-id', 'intent-id')).resolves.toMatchObject({ status: 'EXPIRED' });
    expect(transaction.orderIntentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ toStatus: 'EXPIRED', reason: 'PAYMENT_WINDOW_EXPIRED' }),
      }),
    );
    expect(transaction.coupon.updateMany).toHaveBeenCalledOnce();
  });
});
