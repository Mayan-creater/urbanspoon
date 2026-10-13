import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PricingRule } from '@prisma/client';
import { availableLoyaltyPoints, calculateLoyaltyRedemption } from '../loyalty/loyalty-ledger.js';
import type {
  AddCartItemDto,
  CheckoutPreviewDto,
  CreateCartDto,
  CreateCouponDto,
  CreatePricingRuleDto,
  UpdateCartItemDto,
} from './carts.dto.js';
import { PrismaService } from '../database/prisma.service.js';

const cartInclude = {
  restaurant: {
    select: {
      id: true,
      name: true,
      status: true,
      isAcceptingOrders: true,
      timezone: true,
      city: true,
      state: true,
      latitude: true,
      longitude: true,
      serviceRadiusKm: true,
      hours: { orderBy: { dayOfWeek: 'asc' as const } },
    },
  },
  items: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      menuItem: {
        include: {
          category: true,
          optionGroups: {
            orderBy: { sortOrder: 'asc' as const },
            include: {
              options: { where: { isAvailable: true }, orderBy: { sortOrder: 'asc' as const } },
            },
          },
        },
      },
      selections: true,
      addedBy: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.CartInclude;

type CartWithItems = Prisma.CartGetPayload<{ include: typeof cartInclude }>;
type MenuItemForOptions = Prisma.MenuItemGetPayload<{
  include: { category: true; optionGroups: { include: { options: true } } };
}>;

interface OptionSnapshot {
  optionId: string;
  groupName: string;
  optionName: string;
  priceDeltaMinor: number;
}

const weekdayIndex: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function restaurantIsOpen(restaurant: CartWithItems['restaurant'], now: Date) {
  if (restaurant.status !== 'ACTIVE' || !restaurant.isAcceptingOrders) return false;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: restaurant.timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const today = weekdayIndex[values.weekday];
  const currentTime = `${values.hour}:${values.minute}`;
  const todayHours = restaurant.hours.find((hours) => hours.dayOfWeek === today);
  if (todayHours && !todayHours.isClosed) {
    if (todayHours.openTime <= todayHours.closeTime) {
      if (currentTime >= todayHours.openTime && currentTime < todayHours.closeTime) return true;
    } else if (currentTime >= todayHours.openTime) {
      return true;
    }
  }
  const previousHours = restaurant.hours.find((hours) => hours.dayOfWeek === (today + 6) % 7);
  return Boolean(
    previousHours &&
    !previousHours.isClosed &&
    previousHours.openTime > previousHours.closeTime &&
    currentTime < previousHours.closeTime,
  );
}

function distanceInKm(
  latitude: number,
  longitude: number,
  targetLatitude: number,
  targetLongitude: number,
) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(targetLatitude - latitude);
  const longitudeDelta = radians(targetLongitude - longitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(latitude)) *
      Math.cos(radians(targetLatitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

@Injectable()
export class CartsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const cart = await this.prisma.cart.findUnique({ where: { userId }, include: cartInclude });
    return cart ? [cart] : [];
  }

  async get(userId: string, cartId: string) {
    const cart = await this.prisma.cart.findFirst({
      where: { id: cartId, userId },
      include: cartInclude,
    });
    if (!cart) throw new NotFoundException('Cart not found');
    return cart;
  }

  async create(userId: string, input: CreateCartDto) {
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: input.restaurantId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!restaurant) throw new NotFoundException('Restaurant not found');

    const cart = await this.prisma.cart.upsert({
      where: { userId },
      create: { userId, restaurantId: input.restaurantId },
      update: {},
      select: { id: true, restaurantId: true },
    });
    if (cart.restaurantId !== input.restaurantId) {
      throw new ConflictException('Clear your current cart before switching restaurants');
    }
    return this.get(userId, cart.id);
  }

  async addItem(userId: string, cartId: string, input: AddCartItemDto) {
    return this.prisma.$transaction(async (transaction) => {
      const cart = await transaction.cart.findFirst({ where: { id: cartId, userId } });
      if (!cart) throw new NotFoundException('Cart not found');
      await this.assertCartIsEditable(transaction, cartId);
      const menuItem = await this.findCurrentMenuItem(
        transaction,
        cart.restaurantId,
        input.menuItemId,
      );
      if (menuItem.currency !== cart.currency) {
        throw new ConflictException('Cart items must use the cart currency');
      }
      const selections = this.validateSelections(menuItem, input.optionIds ?? []);
      const itemCount = await transaction.cartItem.count({ where: { cartId } });
      if (itemCount >= 100) throw new BadRequestException('A cart can contain at most 100 lines');
      const item = await transaction.cartItem.create({
        data: {
          cartId,
          menuItemId: menuItem.id,
          addedByUserId: userId,
          quantity: input.quantity,
          selections: { create: this.selectionRows(selections) },
        },
      });
      return transaction.cart
        .findFirst({ where: { id: cartId, userId }, include: cartInclude })
        .then((result) => {
          if (!result) throw new NotFoundException('Cart not found');
          return { ...result, addedItemId: item.id };
        });
    });
  }

  async updateItem(userId: string, cartId: string, itemId: string, input: UpdateCartItemDto) {
    return this.prisma.$transaction(async (transaction) => {
      const line = await transaction.cartItem.findFirst({
        where: { id: itemId, cartId, cart: { userId } },
        include: {
          menuItem: { include: { category: true, optionGroups: { include: { options: true } } } },
        },
      });
      if (!line) throw new NotFoundException('Cart item not found');
      await this.assertCartIsEditable(transaction, cartId);
      const updateData: Prisma.CartItemUpdateInput = {};
      if (input.quantity !== undefined) updateData.quantity = input.quantity;
      if (input.optionIds !== undefined) {
        const selections = this.validateSelections(line.menuItem, input.optionIds);
        await transaction.cartItemOptionSelection.deleteMany({ where: { cartItemId: itemId } });
        if (selections.length) {
          await transaction.cartItemOptionSelection.createMany({
            data: this.selectionRows(selections).map((selection) => ({
              cartItemId: itemId,
              ...selection,
            })),
          });
        }
      }
      await transaction.cartItem.update({ where: { id: itemId }, data: updateData });
      const cart = await transaction.cart.findFirst({
        where: { id: cartId, userId },
        include: cartInclude,
      });
      if (!cart) throw new NotFoundException('Cart not found');
      return cart;
    });
  }

  async removeItem(userId: string, cartId: string, itemId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const cart = await transaction.cart.findFirst({ where: { id: cartId, userId } });
      if (!cart) throw new NotFoundException('Cart not found');
      await this.assertCartIsEditable(transaction, cartId);
      const result = await transaction.cartItem.deleteMany({ where: { id: itemId, cartId } });
      if (!result.count) throw new NotFoundException('Cart item not found');
      return { deleted: true };
    });
  }

  async clear(userId: string, cartId: string) {
    const cart = await this.prisma.cart.findFirst({ where: { id: cartId, userId } });
    if (!cart) throw new NotFoundException('Cart not found');
    const groupOrder = await this.prisma.groupOrder.findUnique({ where: { cartId } });
    if (groupOrder) throw new ConflictException('Leave or finish the group order before clearing its cart');
    const result = await this.prisma.cart.deleteMany({ where: { id: cartId, userId } });
    if (!result.count) throw new NotFoundException('Cart not found');
    return { cleared: true };
  }

  async addGroupItem(userId: string, cartId: string, groupOrderId: string, input: AddCartItemDto) {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "GroupOrder" WHERE "id" = ${groupOrderId}::uuid FOR UPDATE`,
      );
      const groupOrder = await transaction.groupOrder.findFirst({
        where: {
          id: groupOrderId,
          cartId,
          status: 'OPEN',
          OR: [{ deadlineAt: null }, { deadlineAt: { gt: new Date() } }],
          members: { some: { userId } },
        },
        include: { cart: true },
      });
      if (!groupOrder) throw new NotFoundException('Open group order membership not found');
      const menuItem = await this.findCurrentMenuItem(
        transaction,
        groupOrder.cart.restaurantId,
        input.menuItemId,
      );
      if (menuItem.currency !== groupOrder.cart.currency) {
        throw new ConflictException('Cart items must use the cart currency');
      }
      const selections = this.validateSelections(menuItem, input.optionIds ?? []);
      const itemCount = await transaction.cartItem.count({ where: { cartId } });
      if (itemCount >= 100) throw new BadRequestException('A cart can contain at most 100 lines');
      const item = await transaction.cartItem.create({
        data: {
          cartId,
          menuItemId: menuItem.id,
          addedByUserId: userId,
          quantity: input.quantity,
          selections: { create: this.selectionRows(selections) },
        },
      });
      return { itemId: item.id, addedByUserId: userId };
    });
  }

  async removeGroupItem(userId: string, cartId: string, groupOrderId: string, itemId: string) {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "GroupOrder" WHERE "id" = ${groupOrderId}::uuid FOR UPDATE`,
      );
      const groupOrder = await transaction.groupOrder.findFirst({
        where: {
          id: groupOrderId,
          cartId,
          status: 'OPEN',
          OR: [{ deadlineAt: null }, { deadlineAt: { gt: new Date() } }],
          members: { some: { userId } },
        },
        select: { hostUserId: true },
      });
      if (!groupOrder) throw new NotFoundException('Open group order membership not found');
      const item = await transaction.cartItem.findFirst({
        where: { id: itemId, cartId },
        select: { id: true, addedByUserId: true },
      });
      if (!item) throw new NotFoundException('Group cart item not found');
      if (groupOrder.hostUserId !== userId && item.addedByUserId !== userId) {
        throw new NotFoundException('Group cart item not found');
      }
      await transaction.cartItem.delete({ where: { id: item.id } });
      return { deleted: true };
    });
  }

  async updateGroupItem(
    userId: string,
    cartId: string,
    groupOrderId: string,
    itemId: string,
    input: UpdateCartItemDto,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "GroupOrder" WHERE "id" = ${groupOrderId}::uuid FOR UPDATE`,
      );
      const groupOrder = await transaction.groupOrder.findFirst({
        where: {
          id: groupOrderId,
          cartId,
          status: 'OPEN',
          OR: [{ deadlineAt: null }, { deadlineAt: { gt: new Date() } }],
          members: { some: { userId } },
        },
        select: { hostUserId: true },
      });
      if (!groupOrder) throw new NotFoundException('Open group order membership not found');
      const item = await transaction.cartItem.findFirst({
        where: { id: itemId, cartId },
        select: { id: true, addedByUserId: true },
      });
      if (!item) throw new NotFoundException('Group cart item not found');
      if (groupOrder.hostUserId !== userId && item.addedByUserId !== userId) {
        throw new NotFoundException('Group cart item not found');
      }
      return transaction.cartItem.update({
        where: { id: item.id },
        data: { ...(input.quantity !== undefined ? { quantity: input.quantity } : {}) },
      });
    });
  }

  async preview(userId: string, input: CheckoutPreviewDto) {
    const cart = await this.prisma.cart.findFirst({
      where: { id: input.cartId, userId },
      include: {
        ...cartInclude,
        restaurant: { include: { hours: { orderBy: { dayOfWeek: 'asc' } } } },
        items: {
          orderBy: { createdAt: 'asc' },
          include: {
            menuItem: {
              include: {
                category: true,
                optionGroups: {
                  orderBy: { sortOrder: 'asc' },
                  include: { options: { orderBy: { sortOrder: 'asc' } } },
                },
              },
            },
            selections: true,
            addedBy: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!cart) throw new NotFoundException('Cart not found');
    const groupOrder = await this.prisma.groupOrder.findUnique({
      where: { cartId: cart.id },
      select: { status: true, deadlineAt: true },
    });
    if (groupOrder && groupOrder.status !== 'LOCKED') {
      throw new ConflictException('The group order must be locked before checkout');
    }
    if (groupOrder?.deadlineAt && groupOrder.deadlineAt <= new Date()) {
      throw new ConflictException('The group order deadline has passed');
    }
    if (!cart.items.length) throw new BadRequestException('Cart is empty');
    const now = new Date();
    if (!restaurantIsOpen(cart.restaurant, now)) {
      throw new ConflictException('Restaurant is not accepting orders right now');
    }

    let address: {
      id: string;
      label: string;
      line1: string;
      line2: string | null;
      city: string;
      state: string;
      postalCode: string;
      country: string;
      latitude: number | null;
      longitude: number | null;
    } | null = null;
    if (input.addressId) {
      const savedAddress = await this.prisma.userAddress.findFirst({
        where: { id: input.addressId, userId },
        select: {
          id: true,
          label: true,
          line1: true,
          line2: true,
          city: true,
          state: true,
          postalCode: true,
          country: true,
          latitude: true,
          longitude: true,
        },
      });
      if (!savedAddress) throw new NotFoundException('Delivery address not found');
      const sameCity =
        savedAddress.city.trim().toLocaleLowerCase() ===
        cart.restaurant.city.trim().toLocaleLowerCase();
      if (
        savedAddress.latitude !== null &&
        savedAddress.longitude !== null &&
        cart.restaurant.latitude !== null &&
        cart.restaurant.longitude !== null
      ) {
        const distance = distanceInKm(
          savedAddress.latitude,
          savedAddress.longitude,
          cart.restaurant.latitude,
          cart.restaurant.longitude,
        );
        if (distance > cart.restaurant.serviceRadiusKm) {
          throw new BadRequestException('Restaurant does not serve the selected address');
        }
      } else if (!sameCity) {
        throw new BadRequestException('Restaurant does not serve the selected city');
      }
      address = savedAddress;
    }

    const previewItems = cart.items.map((line) => {
      const menuItem = line.menuItem;
      if (
        menuItem.restaurantId !== cart.restaurantId ||
        menuItem.currency !== cart.currency ||
        !menuItem.isAvailable ||
        menuItem.archivedAt ||
        (menuItem.categoryId && !menuItem.category?.isActive)
      ) {
        throw new ConflictException(`${menuItem.name} is no longer available`);
      }
      const selections = this.validateSelections(
        menuItem,
        line.selections.map(({ optionId }) => optionId),
      );
      const selectedOptionMinor = selections.reduce(
        (total, selection) => total + selection.priceDeltaMinor,
        0,
      );
      const unitPriceMinor = menuItem.priceMinor + selectedOptionMinor;
      return {
        cartItemId: line.id,
        menuItemId: menuItem.id,
        name: menuItem.name,
        quantity: line.quantity,
        baseUnitPriceMinor: menuItem.priceMinor,
        selectedOptions: selections.map(({ groupName, optionName, priceDeltaMinor }) => ({
          groupName,
          optionName,
          priceDeltaMinor,
        })),
        unitPriceMinor,
        lineSubtotalMinor: unitPriceMinor * line.quantity,
      };
    });
    const subtotalMinor = previewItems.reduce((total, item) => total + item.lineSubtotalMinor, 0);
    const rules = await this.activePricingRules(
      cart.currency,
      address?.state ?? cart.restaurant.state,
      now,
    );
    const requiredTypes: Array<PricingRule['type']> = [
      'DELIVERY_FEE',
      'PACKAGING_FEE',
      'SERVICE_FEE',
      'TAX',
    ];
    for (const type of requiredTypes) {
      if (!rules.some((rule) => rule.type === type)) {
        throw new ConflictException(`Checkout pricing rule is not configured: ${type}`);
      }
    }

    if (input.loyaltyPoints && input.couponCode?.trim()) {
      throw new BadRequestException('Coupon codes and FoodCoins cannot be combined');
    }
    let coupon: { code: string; discountMinor: number } | null = null;
    if (input.couponCode) {
      coupon = await this.calculateCouponDiscount(
        input.couponCode.trim().toUpperCase(),
        cart,
        subtotalMinor,
        now,
        userId,
      );
    }
    let loyaltyRedemption: {
      points: number;
      discountMinor: number;
      ruleId: string;
      ruleVersion: number;
    } | null = null;
    if (input.loyaltyPoints) {
      const loyaltyRule = await this.prisma.loyaltyRule.findFirst({
        where: {
          currency: cart.currency,
          isActive: true,
          effectiveFrom: { lte: now },
          OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }],
        },
        orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
      });
      if (!loyaltyRule) throw new ConflictException('FoodCoins redemption is not configured');
      const availablePoints = await this.prisma.$transaction((transaction) =>
        availableLoyaltyPoints(transaction, userId, now),
      );
      const redemption = calculateLoyaltyRedemption(
        input.loyaltyPoints,
        availablePoints,
        subtotalMinor,
        loyaltyRule.redeemMinorPerPoint,
      );
      loyaltyRedemption = {
        ...redemption,
        ruleId: loyaltyRule.id,
        ruleVersion: loyaltyRule.version,
      };
    }
    const discountMinor = coupon?.discountMinor ?? loyaltyRedemption?.discountMinor ?? 0;
    if (input.tipBasisPoints && input.customTipMinor !== undefined) {
      throw new BadRequestException('Choose either a tip preset or a custom tip amount');
    }
    const customTipMinor = input.customTipMinor ?? 0;
    const tipBasisPoints = input.tipBasisPoints ?? 0;
    const tipBaseMinor = Math.max(0, subtotalMinor - discountMinor);
    const tipMinor = customTipMinor || Math.round((tipBaseMinor * tipBasisPoints) / 10000);
    if (tipMinor > Math.round(tipBaseMinor / 2)) {
      throw new BadRequestException(
        'Courier tip cannot exceed 50% of the discounted item subtotal',
      );
    }
    const rulesByType = new Map<PricingRule['type'], PricingRule>();
    for (const rule of rules) {
      if (!rulesByType.has(rule.type)) rulesByType.set(rule.type, rule);
    }
    const calculate = (rule: PricingRule, base: number) =>
      rule.valueType === 'FIXED' ? rule.value : Math.round((base * rule.value) / 10000);
    const feeRules = [
      rulesByType.get('DELIVERY_FEE')!,
      rulesByType.get('PACKAGING_FEE')!,
      rulesByType.get('SERVICE_FEE')!,
    ];
    const charges: Array<{
      type: string;
      amountMinor: number;
      currency: string;
      taxable: boolean;
      ruleId: string | null;
      ruleVersion: number | null;
    }> = [
      {
        type: 'ITEM_SUBTOTAL',
        amountMinor: subtotalMinor,
        currency: cart.currency,
        taxable: false,
        ruleId: null,
        ruleVersion: null,
      },
    ];
    if (discountMinor) {
      charges.push({
        type: coupon ? 'COUPON_DISCOUNT' : 'LOYALTY_REDEMPTION',
        amountMinor: -discountMinor,
        currency: cart.currency,
        taxable: false,
        ruleId: null,
        ruleVersion: null,
      });
    }
    let feeTotalMinor = 0;
    const feeAmounts = new Map<string, number>();
    for (const rule of feeRules) {
      const amountMinor = calculate(rule, subtotalMinor);
      feeAmounts.set(rule.type, amountMinor);
      feeTotalMinor += amountMinor;
      charges.push({
        type: rule.type,
        amountMinor,
        currency: cart.currency,
        taxable: rule.taxable,
        ruleId: rule.id,
        ruleVersion: rule.version,
      });
    }
    const taxRule = rulesByType.get('TAX')!;
    const taxableBases: Record<string, number> = {
      ITEM_SUBTOTAL: Math.max(0, subtotalMinor - discountMinor),
      DELIVERY_FEE: feeRules[0].taxable ? (feeAmounts.get('DELIVERY_FEE') ?? 0) : 0,
      PACKAGING_FEE: feeRules[1].taxable ? (feeAmounts.get('PACKAGING_FEE') ?? 0) : 0,
      SERVICE_FEE: feeRules[2].taxable ? (feeAmounts.get('SERVICE_FEE') ?? 0) : 0,
    };
    const taxBaseMinor = taxRule.appliesTo.reduce(
      (total, chargeType) => total + (taxableBases[chargeType] ?? 0),
      0,
    );
    const taxMinor = calculate(taxRule, taxBaseMinor);
    charges.push({
      type: 'TAX',
      amountMinor: taxMinor,
      currency: cart.currency,
      taxable: false,
      ruleId: taxRule.id,
      ruleVersion: taxRule.version,
    });
    if (tipMinor > 0) {
      charges.push({
        type: 'COURIER_TIP',
        amountMinor: tipMinor,
        currency: cart.currency,
        taxable: false,
        ruleId: null,
        ruleVersion: null,
      });
    }
    return {
      cartId: cart.id,
      restaurant: { id: cart.restaurant.id, name: cart.restaurant.name },
      address,
      currency: cart.currency,
      items: previewItems,
      subtotalMinor,
      coupon,
      loyaltyRedemption,
      discountMinor,
      feesMinor: feeTotalMinor,
      taxMinor,
      tipMinor,
      totalMinor: Math.max(0, subtotalMinor - discountMinor + feeTotalMinor + taxMinor + tipMinor),
      charges,
      pricingRuleVersions: rules.map(({ ruleKey, id, version }) => ({
        ruleKey,
        ruleId: id,
        version,
      })),
      expiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
    };
  }

  async canConfirmSnapshot(
    transaction: Prisma.TransactionClient,
    restaurantId: string,
    snapshot: Prisma.JsonValue,
    now: Date,
  ) {
    if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) return false;
    const snapshotItems = (snapshot as Prisma.JsonObject).items;
    if (!Array.isArray(snapshotItems) || snapshotItems.length === 0) return false;
    const items = snapshotItems.filter(
      (item): item is Prisma.JsonObject => typeof item === 'object' && item !== null,
    );
    if (items.length !== snapshotItems.length) return false;
    const itemIds = items.map((item) => item.menuItemId);
    if (itemIds.some((id) => typeof id !== 'string')) return false;

    const restaurant = await transaction.restaurant.findUnique({
      where: { id: restaurantId },
      include: { hours: true },
    });
    if (!restaurant || !restaurantIsOpen(restaurant, now)) return false;

    const currentItems = await transaction.menuItem.findMany({
      where: { id: { in: itemIds as string[] }, restaurantId },
      include: {
        category: true,
        optionGroups: { include: { options: { where: { isAvailable: true } } } },
      },
    });
    if (currentItems.length !== new Set(itemIds).size) return false;

    for (const item of items) {
      const current = currentItems.find(({ id }) => id === item.menuItemId);
      if (
        !current ||
        !current.isAvailable ||
        current.archivedAt ||
        (current.categoryId && !current.category?.isActive)
      ) {
        return false;
      }
      const selections = item.selectedOptions;
      if (!Array.isArray(selections)) return false;
      for (const selection of selections) {
        if (typeof selection !== 'object' || selection === null || Array.isArray(selection)) {
          return false;
        }
        const groupName = selection.groupName;
        const optionName = selection.optionName;
        if (
          typeof groupName !== 'string' ||
          typeof optionName !== 'string' ||
          !current.optionGroups.some(
            (group) =>
              group.name === groupName &&
              group.options.some((option) => option.name === optionName),
          )
        ) {
          return false;
        }
      }
    }

    const address = (snapshot as Prisma.JsonObject).address;
    if (typeof address === 'object' && address !== null && !Array.isArray(address)) {
      const deliveryAddress = address as Prisma.JsonObject;
      const sameCity =
        typeof deliveryAddress.city === 'string' &&
        deliveryAddress.city.trim().toLocaleLowerCase() ===
          restaurant.city.trim().toLocaleLowerCase();
      const hasCoordinates =
        typeof deliveryAddress.latitude === 'number' &&
        typeof deliveryAddress.longitude === 'number' &&
        restaurant.latitude !== null &&
        restaurant.longitude !== null;
      if (hasCoordinates) {
        if (
          distanceInKm(
            deliveryAddress.latitude as number,
            deliveryAddress.longitude as number,
            restaurant.latitude!,
            restaurant.longitude!,
          ) > restaurant.serviceRadiusKm
        ) {
          return false;
        }
      } else if (!sameCity) {
        return false;
      }
    }
    return true;
  }

  async validateCoupon(userId: string, input: CheckoutPreviewDto) {
    if (!input.couponCode?.trim()) throw new BadRequestException('Coupon code is required');
    const preview = await this.preview(userId, input);
    if (!preview.coupon) throw new BadRequestException('Coupon code could not be applied');
    return {
      code: preview.coupon.code,
      discountMinor: preview.discountMinor,
      currency: preview.currency,
      subtotalMinor: preview.subtotalMinor,
      totalMinor: preview.totalMinor,
    };
  }

  listPricingRules() {
    return this.prisma.pricingRule.findMany({ orderBy: [{ ruleKey: 'asc' }, { version: 'desc' }] });
  }

  async createPricingRule(actor: string, input: CreatePricingRuleDto, correlationId?: string) {
    if (input.valueType === 'PERCENTAGE' && input.value > 10000) {
      throw new BadRequestException('Percentage pricing values cannot exceed 10000 basis points');
    }
    const effectiveFrom = new Date(input.effectiveFrom);
    const effectiveUntil = input.effectiveUntil ? new Date(input.effectiveUntil) : null;
    if (effectiveUntil && effectiveFrom >= effectiveUntil) {
      throw new BadRequestException('Pricing rule end must be after its start');
    }
    return this.prisma.$transaction(async (transaction) => {
      const versions = await transaction.pricingRule.findMany({
        where: { ruleKey: input.ruleKey },
        orderBy: { version: 'desc' },
        take: 1,
      });
      const version = (versions[0]?.version ?? 0) + 1;
      await transaction.pricingRule.updateMany({
        where: { ruleKey: input.ruleKey, isActive: true },
        data: { effectiveUntil: effectiveFrom },
      });
      const rule = await transaction.pricingRule.create({
        data: {
          ...input,
          version,
          currency: input.currency ?? 'INR',
          scopeState: input.scopeState?.trim() || null,
          appliesTo: input.appliesTo ?? [],
          taxable: input.taxable ?? false,
          effectiveFrom,
          effectiveUntil,
          isActive: true,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: actor,
          permission: 'admin.pricing.manage',
          action: 'PRICING_RULE_VERSION_CREATED',
          entityType: 'pricing_rule',
          entityId: rule.id,
          after: {
            ruleKey: rule.ruleKey,
            version: rule.version,
            type: rule.type,
            valueType: rule.valueType,
            value: rule.value,
            currency: rule.currency,
            scopeState: rule.scopeState,
          },
          correlationId,
        },
      });
      return rule;
    });
  }

  listCoupons() {
    return this.prisma.coupon.findMany({
      orderBy: [{ isActive: 'desc' }, { endsAt: 'asc' }],
      include: { restaurant: { select: { id: true, name: true } } },
    });
  }

  async createCoupon(actor: string, input: CreateCouponDto, correlationId?: string) {
    if (input.discountType === 'PERCENTAGE' && input.discountValue > 10000) {
      throw new BadRequestException('Percentage coupons cannot exceed 10000 basis points');
    }
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (startsAt >= endsAt) throw new BadRequestException('Coupon end must be after its start');
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${'coupon:' + input.campaignKey}))`,
      );
      if (input.restaurantId) {
        const restaurant = await transaction.restaurant.findFirst({
          where: { id: input.restaurantId, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!restaurant) throw new NotFoundException('Restaurant not found');
      }
      const code = input.code.trim().toUpperCase();
      const existing = await transaction.coupon.findUnique({ where: { code } });
      if (existing) throw new ConflictException('Coupon code already exists');
      const latestVersion = await transaction.coupon.findFirst({
        where: { campaignKey: input.campaignKey },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const version = (latestVersion?.version ?? 0) + 1;
      await transaction.coupon.updateMany({
        where: { campaignKey: input.campaignKey, isActive: true, endsAt: { gt: startsAt } },
        data: { endsAt: startsAt },
      });
      const coupon = await transaction.coupon.create({
        data: {
          ...input,
          campaignKey: input.campaignKey,
          campaignName: input.campaignName.trim(),
          version,
          code,
          currency: input.currency ?? 'INR',
          minSubtotalMinor: input.minSubtotalMinor ?? 0,
          maxDiscountMinor: input.maxDiscountMinor ?? null,
          usageLimit: input.usageLimit ?? null,
          perUserLimit: input.perUserLimit ?? null,
          firstOrderOnly: input.firstOrderOnly ?? false,
          startsAt,
          endsAt,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: actor,
          permission: 'admin.promotions.manage',
          action: 'COUPON_CREATED',
          entityType: 'coupon',
          entityId: coupon.id,
          after: {
            code: coupon.code,
            campaignKey: coupon.campaignKey,
            campaignName: coupon.campaignName,
            version: coupon.version,
            discountType: coupon.discountType,
            discountValue: coupon.discountValue,
            restaurantId: coupon.restaurantId,
            perUserLimit: coupon.perUserLimit,
            firstOrderOnly: coupon.firstOrderOnly,
            startsAt,
            endsAt,
          },
          correlationId,
        },
      });
      return coupon;
    });
  }

  async disableCoupon(actor: string, couponId: string, correlationId?: string) {
    return this.prisma.$transaction(async (transaction) => {
      const coupon = await transaction.coupon.findUnique({ where: { id: couponId } });
      if (!coupon) throw new NotFoundException('Coupon not found');
      if (!coupon.isActive) return coupon;
      const disabled = await transaction.coupon.update({
        where: { id: couponId },
        data: { isActive: false },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: actor,
          permission: 'admin.promotions.manage',
          action: 'COUPON_DISABLED',
          entityType: 'coupon',
          entityId: couponId,
          before: { isActive: coupon.isActive },
          after: { isActive: disabled.isActive },
          correlationId,
        },
      });
      return disabled;
    });
  }

  private async findCurrentMenuItem(
    transaction: Prisma.TransactionClient,
    restaurantId: string,
    menuItemId: string,
  ): Promise<MenuItemForOptions> {
    const item = await transaction.menuItem.findFirst({
      where: { id: menuItemId, restaurantId, isAvailable: true, archivedAt: null },
      include: { category: true, optionGroups: { include: { options: true } } },
    });
    if (!item || (item.categoryId && !item.category?.isActive)) {
      throw new NotFoundException('Available menu item not found');
    }
    return item;
  }

  private validateSelections(menuItem: MenuItemForOptions, optionIds: string[]): OptionSnapshot[] {
    const selectedIds = new Set(optionIds);
    const selections: OptionSnapshot[] = [];
    for (const group of menuItem.optionGroups) {
      const chosen = group.options.filter((option) => selectedIds.has(option.id));
      if (chosen.some((option) => !option.isAvailable)) {
        throw new ConflictException(`${group.name} contains an unavailable option`);
      }
      if (chosen.length < group.minSelections || chosen.length > group.maxSelections) {
        throw new BadRequestException(
          `${group.name} requires ${group.minSelections}-${group.maxSelections} selections`,
        );
      }
      selections.push(
        ...chosen.map((option) => ({
          optionId: option.id,
          groupName: group.name,
          optionName: option.name,
          priceDeltaMinor: option.priceDeltaMinor,
        })),
      );
    }
    if (selections.length !== selectedIds.size) {
      throw new BadRequestException('One or more selected options do not belong to this menu item');
    }
    return selections;
  }

  private selectionRows(selections: OptionSnapshot[]) {
    return selections.map(({ optionId, groupName, optionName, priceDeltaMinor }) => ({
      optionId,
      groupNameSnapshot: groupName,
      optionNameSnapshot: optionName,
      priceDeltaMinorSnapshot: priceDeltaMinor,
    }));
  }

  private async activePricingRules(currency: string, state: string, now: Date) {
    const candidates = await this.prisma.pricingRule.findMany({
      where: {
        currency,
        isActive: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: now } }],
        AND: [
          { OR: [{ scopeState: null }, { scopeState: { equals: state, mode: 'insensitive' } }] },
        ],
      },
      orderBy: { version: 'desc' },
    });
    const selected = new Map<string, PricingRule>();
    for (const candidate of candidates) {
      const existing = selected.get(candidate.ruleKey);
      if (
        !existing ||
        (candidate.scopeState !== null && existing.scopeState === null) ||
        (candidate.scopeState === existing.scopeState && candidate.version > existing.version)
      ) {
        selected.set(candidate.ruleKey, candidate);
      }
    }
    return [...selected.values()];
  }

  private async assertCartIsEditable(
    transaction: Prisma.TransactionClient | PrismaService,
    cartId: string,
  ) {
    const groupOrder = await transaction.groupOrder.findUnique({
      where: { cartId },
      select: { status: true },
    });
    if (groupOrder && groupOrder.status !== 'OPEN') {
      throw new ConflictException('This group cart is locked and can no longer be changed');
    }
  }

  private async calculateCouponDiscount(
    code: string,
    cart: CartWithItems,
    subtotalMinor: number,
    now: Date,
    userId: string,
  ) {
    const coupon = await this.prisma.coupon.findUnique({ where: { code } });
    if (
      !coupon ||
      !coupon.isActive ||
      coupon.startsAt > now ||
      coupon.endsAt < now ||
      coupon.currency !== cart.currency ||
      (coupon.restaurantId && coupon.restaurantId !== cart.restaurantId) ||
      subtotalMinor < coupon.minSubtotalMinor ||
      (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit)
    ) {
      throw new BadRequestException('Coupon is invalid or does not apply to this cart');
    }
    if (coupon.firstOrderOnly) {
      const [existingOrder, reservedFirstOrderCoupon] = await Promise.all([
        this.prisma.order.findFirst({ where: { userId }, select: { id: true } }),
        this.prisma.couponRedemption.findFirst({
          where: {
            status: 'RESERVED',
            coupon: { firstOrderOnly: true },
            orderIntent: { userId, status: { in: ['OPEN', 'PAYMENT_PENDING'] } },
          },
          select: { id: true },
        }),
      ]);
      if (existingOrder || reservedFirstOrderCoupon) {
        throw new BadRequestException('First-order coupon is not available to this customer');
      }
    }
    if (coupon.perUserLimit != null) {
      const redemptions = await this.prisma.couponRedemption.count({
        where: {
          coupon: { campaignKey: coupon.campaignKey },
          status: { in: ['RESERVED', 'CONSUMED'] },
          orderIntent: { userId },
        },
      });
      if (redemptions >= coupon.perUserLimit) {
        throw new BadRequestException('Coupon customer usage limit was reached');
      }
    }
    const rawDiscount =
      coupon.discountType === 'FIXED'
        ? coupon.discountValue
        : Math.round((subtotalMinor * coupon.discountValue) / 10000);
    const discountMinor = Math.min(
      subtotalMinor,
      coupon.maxDiscountMinor === null
        ? rawDiscount
        : Math.min(rawDiscount, coupon.maxDiscountMinor),
    );
    return { code: coupon.code, discountMinor };
  }
}
