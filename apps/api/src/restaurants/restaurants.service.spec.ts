import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { RestaurantsService } from './restaurants.service.js';

describe('RestaurantsService', () => {
  it('limits customer discovery to active restaurants and applies the city filter', async () => {
    const prisma = {
      restaurant: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new RestaurantsService(prisma as never);

    await service.listPublic({ city: 'Pune' });

    expect(prisma.restaurant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'ACTIVE',
          city: { equals: 'Pune', mode: 'insensitive' },
        },
        take: 500,
      }),
    );
  });

  it('includes trigram matches for misspelled restaurant and menu search', async () => {
    const restaurant = {
      id: 'restaurant-id',
      name: 'Local Kitchen',
      slug: 'local-kitchen',
      description: null,
      cuisineTypes: ['Italian'],
      addressLine1: '1 Main Road',
      city: 'Pune',
      state: 'MH',
      postalCode: '411001',
      country: 'IN',
      isAcceptingOrders: true,
      timezone: 'Asia/Kolkata',
      hours: [],
      latitude: null,
      longitude: null,
      serviceRadiusKm: 10,
      items: [{ name: 'Pizza', description: 'Cheese pizza', priceMinor: 1200, currency: 'INR' }],
    };
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'restaurant-id', matchedItemNames: ['Pizza'] }]),
      restaurant: { findMany: vi.fn().mockResolvedValue([restaurant]) },
    };
    const service = new RestaurantsService(prisma as never);

    await expect(service.listPublic({ query: 'piza' })).resolves.toMatchObject([
      { id: 'restaurant-id', matchedItems: [{ name: 'Pizza' }] },
    ]);
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(prisma.restaurant.findMany.mock.calls[0][0].where.AND).toContainEqual(
      expect.objectContaining({ OR: expect.arrayContaining([{ id: { in: ['restaurant-id'] } }]) }),
    );
  });

  it('keeps a paused approved restaurant visible as unavailable', async () => {
    const restaurant = {
      id: 'restaurant-id',
      name: 'Local Kitchen',
      slug: 'local-kitchen',
      description: null,
      cuisineTypes: [],
      addressLine1: '1 Main Road',
      city: 'Pune',
      state: 'MH',
      postalCode: '411001',
      country: 'IN',
      isAcceptingOrders: false,
      timezone: 'Asia/Kolkata',
      hours: [],
      latitude: null,
      longitude: null,
      serviceRadiusKm: 10,
      items: [],
    };
    const prisma = { restaurant: { findMany: vi.fn().mockResolvedValue([restaurant]) } };
    const service = new RestaurantsService(prisma as never);

    await expect(service.listPublic()).resolves.toMatchObject([
      { id: 'restaurant-id', isAcceptingOrders: false },
    ]);
    expect(prisma.restaurant.findMany.mock.calls[0][0].where).toEqual({ status: 'ACTIVE' });
  });

  it('combines cuisine, category, dietary, and price filters on eligible menu items', async () => {
    const prisma = { restaurant: { findMany: vi.fn().mockResolvedValue([]) } };
    const service = new RestaurantsService(prisma as never);

    await service.listPublic({
      city: 'Pune',
      cuisine: 'Indian',
      category: 'Breakfast',
      dietary: 'vegan',
      minPriceMinor: 500,
      maxPriceMinor: 2500,
    });

    expect(prisma.restaurant.findMany.mock.calls[0][0].where).toMatchObject({
      status: 'ACTIVE',
      city: { equals: 'Pune', mode: 'insensitive' },
      cuisineTypes: { has: 'Indian' },
      AND: [
        {
          items: {
            some: {
              isAvailable: true,
              archivedAt: null,
              dietaryTags: { has: 'vegan' },
              category: {
                is: { isActive: true, name: { equals: 'Breakfast', mode: 'insensitive' } },
              },
              priceMinor: { gte: 500, lte: 2500 },
            },
          },
        },
      ],
    });
  });

  it('combines rating, ETA, and currently-valid-offer discovery filters', async () => {
    const prisma = { restaurant: { findMany: vi.fn().mockResolvedValue([]) } };
    const service = new RestaurantsService(prisma as never);

    await service.listPublic({ minRating: 4.5, maxEtaMinutes: 35, hasOffer: 'true' });

    expect(prisma.restaurant.findMany.mock.calls[0][0].where).toMatchObject({
      ratingSnapshot: { is: { averageRating: { gte: 4.5 } } },
      estimatedEtaMaxMinutes: { lte: 35 },
      offers: {
        some: {
          isActive: true,
          validFrom: { lte: expect.any(Date) },
          validUntil: { gte: expect.any(Date) },
        },
      },
    });
  });

  it('returns sourced ratings, ETA ranges, current offers, and sorts by rating', async () => {
    const row = (id: string, averageRating: number, eta: number) => ({
      id,
      name: id,
      slug: id,
      description: null,
      cuisineTypes: [],
      addressLine1: '1 Main Road',
      city: 'Pune',
      state: 'MH',
      postalCode: '411001',
      country: 'IN',
      isAcceptingOrders: true,
      timezone: 'Asia/Kolkata',
      estimatedEtaMinMinutes: eta,
      estimatedEtaMaxMinutes: eta + 10,
      ratingSnapshot: { averageRating, reviewCount: 12, source: 'Verified review import' },
      hours: [],
      latitude: null,
      longitude: null,
      serviceRadiusKm: 10,
      offers: [{ id: `${id}-offer`, title: 'Lunch extra', validUntil: new Date() }],
      items: [],
    });
    const prisma = {
      restaurant: {
        findMany: vi.fn().mockResolvedValue([row('lower', 4.2, 25), row('higher', 4.8, 40)]),
      },
    };
    const service = new RestaurantsService(prisma as never);

    await expect(service.listPublic({ sort: 'rating' })).resolves.toMatchObject([
      {
        id: 'higher',
        ratingAverage: 4.8,
        ratingCount: 12,
        ratingSource: 'Verified review import',
        estimatedEtaMinMinutes: 40,
        estimatedEtaMaxMinutes: 50,
        activeOffers: [{ title: 'Lunch extra' }],
      },
      { id: 'lower', ratingAverage: 4.2 },
    ]);
  });

  it('rejects inverted partner ETA bounds before persistence', async () => {
    const prisma = { restaurant: { findFirst: vi.fn() }, $transaction: vi.fn() };
    const service = new RestaurantsService(prisma as never);

    await expect(
      service.create({ id: 'owner-id' } as never, {
        name: 'A Test Kitchen',
        cuisineTypes: ['Test'],
        addressLine1: '1 Main Road',
        city: 'Pune',
        state: 'MH',
        postalCode: '411001',
        estimatedEtaMinMinutes: 60,
        estimatedEtaMaxMinutes: 30,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an offer with an empty validity window before persistence', async () => {
    const prisma = { $transaction: vi.fn() };
    const service = new RestaurantsService(prisma as never);

    await expect(
      service.createPartnerOffer({ id: 'owner-id' } as never, 'restaurant-id', {
        title: 'Lunch extra',
        description: 'A sample offer for lunch orders.',
        redemptionInstructions: 'Mention this offer when ordering.',
        validFrom: '2026-10-08T12:00:00.000Z',
        validUntil: '2026-10-08T12:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('stores rating provenance and audits administrator snapshot updates', async () => {
    const snapshot = {
      id: 'rating-snapshot-id',
      restaurantId: 'restaurant-id',
      averageRating: 4.7,
      reviewCount: 42,
      source: 'Verified reviews',
    };
    const transaction = {
      restaurant: { findUnique: vi.fn().mockResolvedValue({ id: 'restaurant-id' }) },
      restaurantRatingSnapshot: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue(snapshot),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new RestaurantsService(prisma as never);

    await expect(
      service.updateRatingSnapshot({ id: 'admin-id' } as never, 'restaurant-id', {
        averageRating: 4.7,
        reviewCount: 42,
        source: 'Verified reviews',
      }),
    ).resolves.toMatchObject({ averageRating: 4.7, reviewCount: 42, source: 'Verified reviews' });
    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'RESTAURANT_RATING_SNAPSHOT_UPDATED',
          actorUserId: 'admin-id',
        }),
      }),
    );
  });

  it('rejects incomplete coordinates and inverted price bounds', async () => {
    const service = new RestaurantsService({ restaurant: { findMany: vi.fn() } } as never);

    await expect(service.listPublic({ latitude: 18.5 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.listPublic({ minPriceMinor: 2500, maxPriceMinor: 500 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('filters and sorts by distance within the restaurant service radius', async () => {
    const row = (id: string, longitude: number) => ({
      id,
      name: id,
      slug: id,
      description: null,
      cuisineTypes: [],
      addressLine1: '1 Main Road',
      city: 'Pune',
      state: 'MH',
      postalCode: '411001',
      country: 'IN',
      isAcceptingOrders: true,
      timezone: 'Asia/Kolkata',
      hours: [],
      latitude: 18.5,
      longitude,
      serviceRadiusKm: 10,
      items: [{ name: 'Meal', description: null, priceMinor: 1000, currency: 'INR' }],
    });
    const prisma = {
      restaurant: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            row('outside-radius', 73.2),
            row('farther', 73.05),
            row('nearer', 73.02),
          ]),
      },
    };
    const service = new RestaurantsService(prisma as never);

    await expect(
      service.listPublic({ latitude: 18.5, longitude: 73, maxDistanceKm: 50, sort: 'distance' }),
    ).resolves.toMatchObject([
      { id: 'nearer', isServiceable: true },
      { id: 'farther', isServiceable: true },
    ]);
    expect(prisma.restaurant.findMany.mock.calls[0][0].where.AND).toContainEqual(
      expect.objectContaining({
        latitude: expect.objectContaining({ not: null }),
        longitude: expect.objectContaining({ gte: expect.any(Number), lte: expect.any(Number) }),
      }),
    );
  });

  it('finds nearby restaurants across the international date line', async () => {
    const restaurant = {
      id: 'across-date-line',
      name: 'Island Kitchen',
      slug: 'island-kitchen',
      description: null,
      cuisineTypes: [],
      addressLine1: '1 Main Road',
      city: 'Suva',
      state: 'Central',
      postalCode: '00000',
      country: 'FJ',
      isAcceptingOrders: true,
      timezone: 'Pacific/Fiji',
      hours: [],
      latitude: 0,
      longitude: -179.9,
      serviceRadiusKm: 30,
      items: [],
    };
    const prisma = { restaurant: { findMany: vi.fn().mockResolvedValue([restaurant]) } };
    const service = new RestaurantsService(prisma as never);

    await expect(
      service.listPublic({ latitude: 0, longitude: 179.9, maxDistanceKm: 30, sort: 'distance' }),
    ).resolves.toMatchObject([{ id: 'across-date-line', isServiceable: true }]);
    expect(prisma.restaurant.findMany.mock.calls[0][0].where.AND).toContainEqual(
      expect.objectContaining({
        OR: expect.arrayContaining([
          { longitude: { gte: expect.any(Number) } },
          { longitude: { lte: expect.any(Number) } },
        ]),
      }),
    );
  });

  it('uses an idempotent key for saved restaurant favorites', async () => {
    const prisma = {
      restaurant: { findFirst: vi.fn().mockResolvedValue({ id: 'restaurant-id' }) },
      restaurantFavorite: {
        upsert: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const service = new RestaurantsService(prisma as never);

    await service.addFavorite('user-id', 'restaurant-id');
    await service.addFavorite('user-id', 'restaurant-id');
    await service.removeFavorite('user-id', 'restaurant-id');

    expect(prisma.restaurantFavorite.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.restaurantFavorite.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_restaurantId: { userId: 'user-id', restaurantId: 'restaurant-id' } },
      }),
    );
    expect(prisma.restaurantFavorite.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-id', restaurantId: 'restaurant-id' },
    });
  });

  it('reports orderability using the restaurant timezone and weekly hours', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-07T04:00:00.000Z'));
    const restaurant = {
      id: 'restaurant-id',
      name: 'Local Kitchen',
      city: 'Pune',
      state: 'MH',
      postalCode: '411001',
      country: 'IN',
      slug: 'local-kitchen',
      description: null,
      phone: null,
      email: null,
      cuisineTypes: [],
      addressLine1: '1 Main Road',
      isAcceptingOrders: true,
      timezone: 'Asia/Kolkata',
      hours: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        dayOfWeek,
        openTime: '09:00',
        closeTime: '18:00',
        isClosed: dayOfWeek !== 3,
      })),
      latitude: null,
      longitude: null,
      serviceRadiusKm: 10,
      items: [],
    };
    const prisma = {
      restaurant: { findMany: vi.fn().mockResolvedValue([restaurant]) },
    };
    const service = new RestaurantsService(prisma as never);

    try {
      await expect(service.listPublic()).resolves.toMatchObject([{ isAcceptingOrders: true }]);
      vi.setSystemTime(new Date('2026-10-07T14:00:00.000Z'));
      await expect(service.listPublic()).resolves.toMatchObject([{ isAcceptingOrders: false }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not expose a pending restaurant menu', async () => {
    const prisma = {
      restaurant: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = new RestaurantsService(prisma as never);

    await expect(service.getPublicMenu('restaurant-id')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.restaurant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'restaurant-id', status: 'ACTIVE' } }),
    );
  });

  it('rejects menu items assigned to another restaurant category', async () => {
    const prisma = {
      restaurant: { findUnique: vi.fn().mockResolvedValue({ id: 'restaurant-id' }) },
      menuCategory: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(),
    };
    const service = new RestaurantsService(prisma as never);

    await expect(
      service.createMenuItem({ id: 'owner-id' } as never, 'restaurant-id', {
        name: 'Soup',
        priceMinor: 2500,
        categoryId: 'other-category',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
