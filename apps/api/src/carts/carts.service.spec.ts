import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CartsService } from './carts.service.js';

describe('CartsService', () => {
  it('rejects an add-to-cart request missing a required customization', async () => {
    const menuItem = {
      id: 'menu-item-id',
      restaurantId: 'restaurant-id',
      currency: 'INR',
      categoryId: null,
      category: null,
      optionGroups: [
        {
          id: 'size-group',
          name: 'Size',
          minSelections: 1,
          maxSelections: 1,
          options: [
            { id: 'large-option', name: 'Large', priceDeltaMinor: 5000, isAvailable: true },
          ],
        },
      ],
    };
    const transaction = {
      groupOrder: { findUnique: vi.fn().mockResolvedValue(null) },
      cart: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'cart-id', restaurantId: 'restaurant-id', currency: 'INR' }),
      },
      menuItem: { findFirst: vi.fn().mockResolvedValue(menuItem) },
      cartItem: { count: vi.fn().mockResolvedValue(0), create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new CartsService(prisma as never);

    await expect(
      service.addItem('user-id', 'cart-id', { menuItemId: 'menu-item-id', quantity: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction.cartItem.create).not.toHaveBeenCalled();
  });

  it('calculates current customization, coupon, fees, tax, and total on the server', async () => {
    const now = new Date();
    const restaurant = {
      id: 'restaurant-id',
      name: 'Test Kitchen',
      status: 'ACTIVE',
      isAcceptingOrders: true,
      timezone: 'Asia/Kolkata',
      city: 'Pune',
      state: 'Maharashtra',
      latitude: null,
      longitude: null,
      serviceRadiusKm: 10,
      hours: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        dayOfWeek,
        openTime: '00:00',
        closeTime: '23:59',
        isClosed: false,
      })),
    };
    const option = {
      id: 'large-option',
      name: 'Large',
      priceDeltaMinor: 250,
      isAvailable: true,
    };
    const cart = {
      id: 'cart-id',
      restaurantId: 'restaurant-id',
      currency: 'INR',
      restaurant,
      items: [
        {
          id: 'cart-item-id',
          quantity: 2,
          menuItem: {
            id: 'menu-item-id',
            restaurantId: 'restaurant-id',
            name: 'Rice Bowl',
            currency: 'INR',
            priceMinor: 1000,
            isAvailable: true,
            archivedAt: null,
            categoryId: 'category-id',
            category: { isActive: true },
            optionGroups: [
              {
                id: 'size-group',
                name: 'Size',
                minSelections: 1,
                maxSelections: 1,
                options: [option],
              },
            ],
          },
          selections: [{ optionId: option.id, optionNameSnapshot: 'Large' }],
        },
      ],
    };
    const pricingRules = [
      {
        id: 'delivery-rule',
        ruleKey: 'delivery',
        version: 1,
        type: 'DELIVERY_FEE',
        valueType: 'FIXED',
        value: 4000,
        currency: 'INR',
        scopeState: null,
        appliesTo: [],
        taxable: true,
      },
      {
        id: 'packaging-rule',
        ruleKey: 'packaging',
        version: 1,
        type: 'PACKAGING_FEE',
        valueType: 'FIXED',
        value: 1000,
        currency: 'INR',
        scopeState: null,
        appliesTo: [],
        taxable: true,
      },
      {
        id: 'service-rule',
        ruleKey: 'service',
        version: 1,
        type: 'SERVICE_FEE',
        valueType: 'PERCENTAGE',
        value: 200,
        currency: 'INR',
        scopeState: null,
        appliesTo: [],
        taxable: true,
      },
      {
        id: 'tax-rule',
        ruleKey: 'tax',
        version: 1,
        type: 'TAX',
        valueType: 'PERCENTAGE',
        value: 500,
        currency: 'INR',
        scopeState: null,
        appliesTo: ['ITEM_SUBTOTAL', 'DELIVERY_FEE', 'PACKAGING_FEE', 'SERVICE_FEE'],
        taxable: false,
      },
    ];
    const prisma = {
      cart: { findFirst: vi.fn().mockResolvedValue(cart) },
      groupOrder: { findUnique: vi.fn().mockResolvedValue(null) },
      userAddress: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'address-id',
          line1: '2 Test Street',
          city: 'Pune',
          state: 'Delivery State',
          postalCode: '411001',
          latitude: null,
          longitude: null,
        }),
      },
      pricingRule: { findMany: vi.fn().mockResolvedValue(pricingRules) },
      coupon: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'coupon-id',
          campaignKey: 'demo-campaign',
          code: 'SAVE10',
          isActive: true,
          startsAt: new Date(now.getTime() - 60_000),
          endsAt: new Date(now.getTime() + 60_000),
          currency: 'INR',
          restaurantId: null,
          minSubtotalMinor: 1000,
          discountType: 'PERCENTAGE',
          discountValue: 1000,
          maxDiscountMinor: 300,
          usageLimit: 10,
          usageCount: 0,
          perUserLimit: 2,
          firstOrderOnly: true,
        }),
      },
      order: { findFirst: vi.fn().mockResolvedValue(null) },
      couponRedemption: {
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(1),
      },
      loyaltyRule: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'loyalty-rule-id',
          version: 2,
          redeemMinorPerPoint: 1,
        }),
      },
      $transaction: vi.fn((operation: (client: unknown) => unknown) =>
        operation({
          loyaltyTransaction: {
            aggregate: vi.fn().mockResolvedValue({ _sum: { points: 120 } }),
          },
          loyaltyRedemption: {
            aggregate: vi.fn().mockResolvedValue({ _sum: { points: 20 } }),
          },
        }),
      ),
    };
    const service = new CartsService(prisma as never);

    await expect(
      service.preview('user-id', {
        cartId: 'cart-id',
        addressId: 'address-id',
        couponCode: 'save10',
        tipBasisPoints: 1000,
      }),
    ).resolves.toMatchObject({
      subtotalMinor: 2500,
      discountMinor: 250,
      feesMinor: 5050,
      taxMinor: 365,
      tipMinor: 225,
      totalMinor: 7890,
      charges: expect.arrayContaining([
        expect.objectContaining({ type: 'COURIER_TIP', amountMinor: 225 }),
      ]),
      items: [{ unitPriceMinor: 1250, lineSubtotalMinor: 2500 }],
    });
    expect(prisma.couponRedemption.count).toHaveBeenCalledWith({
      where: {
        coupon: { campaignKey: 'demo-campaign' },
        status: { in: ['RESERVED', 'CONSUMED'] },
        orderIntent: { userId: 'user-id' },
      },
    });
    prisma.couponRedemption.count.mockResolvedValue(2);
    await expect(
      service.preview('user-id', { cartId: 'cart-id', couponCode: 'SAVE10' }),
    ).rejects.toThrow('Coupon customer usage limit was reached');
    prisma.order.findFirst.mockResolvedValue({ id: 'prior-order-id' });
    await expect(
      service.preview('user-id', { cartId: 'cart-id', couponCode: 'SAVE10' }),
    ).rejects.toThrow('First-order coupon is not available to this customer');
    await expect(
      service.preview('user-id', {
        cartId: 'cart-id',
        couponCode: 'SAVE10',
        loyaltyPoints: 100,
      }),
    ).rejects.toThrow('Coupon codes and FoodCoins cannot be combined');
    await expect(
      service.preview('user-id', { cartId: 'cart-id', loyaltyPoints: 100 }),
    ).resolves.toMatchObject({
      discountMinor: 100,
      loyaltyRedemption: {
        points: 100,
        discountMinor: 100,
        ruleId: 'loyalty-rule-id',
        ruleVersion: 2,
      },
      totalMinor: 7823,
    });
    expect(prisma.loyaltyRule.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ currency: 'INR' }) }),
    );
    await expect(
      service.preview('user-id', {
        cartId: 'cart-id',
        addressId: 'address-id',
        customTipMinor: 375,
      }),
    ).resolves.toMatchObject({ tipMinor: 375, totalMinor: 8303 });
    await expect(
      service.preview('user-id', {
        cartId: 'cart-id',
        tipBasisPoints: 500,
        customTipMinor: 100,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.pricingRule.findMany.mock.calls[0][0].where.AND).toContainEqual(
      expect.objectContaining({
        OR: expect.arrayContaining([
          { scopeState: { equals: 'Delivery State', mode: 'insensitive' } },
        ]),
      }),
    );
  });

  it('does not allow a user to preview another customer cart', async () => {
    const prisma = { cart: { findFirst: vi.fn().mockResolvedValue(null) } };
    const service = new CartsService(prisma as never);

    await expect(service.preview('other-user', { cartId: 'cart-id' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('adds a validated group item with the participant as its author', async () => {
    const item = {
      id: 'menu-item-id',
      restaurantId: 'restaurant-id',
      currency: 'INR',
      categoryId: null,
      category: null,
      optionGroups: [],
    };
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      groupOrder: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'group-id',
          cartId: 'cart-id',
          status: 'OPEN',
          cart: { restaurantId: 'restaurant-id', currency: 'INR' },
        }),
      },
      menuItem: { findFirst: vi.fn().mockResolvedValue(item) },
      cartItem: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({ id: 'cart-item-id' }),
      },
    };
    const prisma = {
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new CartsService(prisma as never);

    await expect(
      service.addGroupItem('participant-id', 'cart-id', 'group-id', {
        menuItemId: 'menu-item-id',
        quantity: 2,
      }),
    ).resolves.toEqual({ itemId: 'cart-item-id', addedByUserId: 'participant-id' });
    expect(transaction.cartItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cartId: 'cart-id',
        menuItemId: 'menu-item-id',
        addedByUserId: 'participant-id',
        quantity: 2,
      }),
    });
  });

  it('does not reveal or remove another participant’s group item', async () => {
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      groupOrder: {
        findFirst: vi.fn().mockResolvedValue({ hostUserId: 'host-id' }),
      },
      cartItem: {
        findFirst: vi.fn().mockResolvedValue({ id: 'item-id', addedByUserId: 'other-user' }),
        delete: vi.fn(),
      },
    };
    const prisma = {
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new CartsService(prisma as never);

    await expect(
      service.removeGroupItem('participant-id', 'cart-id', 'group-id', 'item-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(transaction.cartItem.delete).not.toHaveBeenCalled();
  });

  it('publishes a new pricing-rule version and audits the source', async () => {
    const rule = {
      id: 'rule-v2',
      ruleKey: 'delivery-fee',
      version: 2,
      type: 'DELIVERY_FEE',
      valueType: 'FIXED',
      value: 5000,
      currency: 'INR',
      source: 'Approved local fee schedule',
    };
    const transaction = {
      pricingRule: {
        findMany: vi.fn().mockResolvedValue([{ version: 1 }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue(rule),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new CartsService(prisma as never);

    await expect(
      service.createPricingRule('admin-id', {
        ruleKey: 'delivery-fee',
        type: 'DELIVERY_FEE',
        valueType: 'FIXED',
        value: 5000,
        source: 'Approved local fee schedule',
        effectiveFrom: new Date().toISOString(),
      }),
    ).resolves.toMatchObject({ version: 2, value: 5000 });
    expect(transaction.pricingRule.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ruleKey: 'delivery-fee', isActive: true },
      }),
    );
    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'PRICING_RULE_VERSION_CREATED',
          actorUserId: 'admin-id',
        }),
      }),
    );
  });

  it('versions a campaign key and audits scope and per-customer eligibility', async () => {
    const campaign = {
      id: 'coupon-v2',
      campaignKey: 'summer-lunch',
      campaignName: 'Summer Lunch',
      version: 2,
      code: 'SUMMER15',
      firstOrderOnly: true,
      perUserLimit: 1,
      restaurantId: null,
    };
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      coupon: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue({ version: 1 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue(campaign),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new CartsService(prisma as never);

    await expect(
      service.createCoupon('admin-id', {
        campaignKey: 'summer-lunch',
        campaignName: 'Summer Lunch',
        code: 'SUMMER15',
        discountType: 'PERCENTAGE',
        discountValue: 1500,
        currency: 'INR',
        perUserLimit: 1,
        firstOrderOnly: true,
        startsAt: '2026-11-01T00:00:00.000Z',
        endsAt: '2026-11-30T00:00:00.000Z',
      }),
    ).resolves.toMatchObject({ version: 2, campaignKey: 'summer-lunch' });
    expect(transaction.coupon.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        campaignKey: 'summer-lunch',
        version: 2,
        perUserLimit: 1,
        firstOrderOnly: true,
      }),
    });
    expect(transaction.coupon.updateMany).toHaveBeenCalledWith({
      where: { campaignKey: 'summer-lunch', isActive: true, endsAt: { gt: expect.any(Date) } },
      data: { endsAt: expect.any(Date) },
    });
  });
});
