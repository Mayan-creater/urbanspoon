import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type {
  CreateCategoryDto,
  CreateMenuItemDto,
  CreateRestaurantOfferDto,
  CreateRestaurantDto,
  DiscoveryQueryDto,
  UpdateCategoryDto,
  UpdateMenuItemDto,
  UpdateRestaurantDto,
  UpdateRestaurantHoursDto,
  UpdateRestaurantRatingDto,
} from './restaurants.dto.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';

const restaurantPublicFields = {
  id: true,
  name: true,
  slug: true,
  description: true,
  cuisineTypes: true,
  addressLine1: true,
  city: true,
  state: true,
  postalCode: true,
  country: true,
  isAcceptingOrders: true,
  timezone: true,
  estimatedEtaMinMinutes: true,
  estimatedEtaMaxMinutes: true,
  ratingSnapshot: {
    select: { averageRating: true, reviewCount: true, source: true, updatedAt: true },
  },
  hours: { orderBy: { dayOfWeek: 'asc' as const } },
} satisfies Prisma.RestaurantSelect;

const currentOfferSelect = {
  id: true,
  title: true,
  description: true,
  terms: true,
  redemptionInstructions: true,
  validFrom: true,
  validUntil: true,
} satisfies Prisma.RestaurantOfferSelect;

const weekdayIndex: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function isRestaurantOpen(
  restaurant: {
    isAcceptingOrders: boolean;
    timezone: string;
    hours: Array<{ dayOfWeek: number; openTime: string; closeTime: string; isClosed: boolean }>;
  },
  now = new Date(),
) {
  if (!restaurant.isAcceptingOrders) return false;
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
  const previousDay = (today + 6) % 7;
  const previousHours = restaurant.hours.find((hours) => hours.dayOfWeek === previousDay);
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

interface FuzzyDiscoveryMatch {
  id: string;
  matchedItemNames: string[];
}

@Injectable()
export class RestaurantsService {
  constructor(private readonly prisma: PrismaService) {}

  async listPublic(filters: DiscoveryQueryDto = {}, userId?: string) {
    const now = new Date();
    const activeOfferWhere: Prisma.RestaurantOfferWhereInput = {
      isActive: true,
      validFrom: { lte: now },
      validUntil: { gte: now },
    };
    if ((filters.latitude === undefined) !== (filters.longitude === undefined)) {
      throw new BadRequestException('Latitude and longitude must be provided together');
    }
    if (
      filters.minPriceMinor !== undefined &&
      filters.maxPriceMinor !== undefined &&
      filters.minPriceMinor > filters.maxPriceMinor
    ) {
      throw new BadRequestException('Minimum price cannot exceed maximum price');
    }
    if (
      (filters.maxDistanceKm !== undefined || filters.sort === 'distance') &&
      filters.latitude === undefined
    ) {
      throw new BadRequestException('Location is required for distance filtering and sorting');
    }

    const searchTerm = filters.query?.trim();
    const sort = filters.sort ?? (searchTerm ? 'relevance' : 'name');
    const fuzzyMatches: FuzzyDiscoveryMatch[] =
      searchTerm && searchTerm.length >= 3
        ? await this.prisma.$queryRaw<FuzzyDiscoveryMatch[]>(Prisma.sql`
            SELECT
              restaurant."id",
              COALESCE(
                array_agg(DISTINCT menu_item."name") FILTER (WHERE menu_item."id" IS NOT NULL),
                ARRAY[]::TEXT[]
              ) AS "matchedItemNames"
            FROM "Restaurant" restaurant
            LEFT JOIN "MenuItem" menu_item
              ON menu_item."restaurantId" = restaurant."id"
              AND menu_item."isAvailable" = true
              AND menu_item."archivedAt" IS NULL
              AND (
                menu_item."categoryId" IS NULL
                OR EXISTS (
                  SELECT 1 FROM "MenuCategory" category
                  WHERE category."id" = menu_item."categoryId" AND category."isActive" = true
                )
              )
              AND (
                lower(menu_item."name") % lower(${searchTerm})
                OR lower(COALESCE(menu_item."description", '')) % lower(${searchTerm})
                OR EXISTS (
                  SELECT 1
                  FROM regexp_split_to_table(lower(menu_item."name"), '[^[:alnum:]]+') AS item_word(word)
                  WHERE item_word.word % lower(${searchTerm})
                )
                OR EXISTS (
                  SELECT 1
                  FROM regexp_split_to_table(lower(COALESCE(menu_item."description", '')), '[^[:alnum:]]+') AS item_word(word)
                  WHERE item_word.word % lower(${searchTerm})
                )
              )
            WHERE restaurant."status" = 'ACTIVE'
              AND (
                lower(restaurant."name") % lower(${searchTerm})
                OR lower(COALESCE(restaurant."description", '')) % lower(${searchTerm})
                OR lower(restaurant."city") % lower(${searchTerm})
                OR EXISTS (
                  SELECT 1
                  FROM regexp_split_to_table(lower(restaurant."name"), '[^[:alnum:]]+') AS restaurant_word(word)
                  WHERE restaurant_word.word % lower(${searchTerm})
                )
                OR EXISTS (
                  SELECT 1 FROM unnest(restaurant."cuisineTypes") cuisine
                  WHERE lower(cuisine) % lower(${searchTerm})
                )
                OR menu_item."id" IS NOT NULL
              )
            GROUP BY restaurant."id"
            ORDER BY GREATEST(
              similarity(lower(restaurant."name"), lower(${searchTerm})),
              similarity(lower(COALESCE(restaurant."description", '')), lower(${searchTerm})),
              similarity(lower(restaurant."city"), lower(${searchTerm})),
              COALESCE(MAX(GREATEST(
                similarity(lower(menu_item."name"), lower(${searchTerm})),
                similarity(lower(COALESCE(menu_item."description", '')), lower(${searchTerm}))
              )), 0)
            ) DESC
            LIMIT 1000
          `)
        : [];
    const fuzzyItemNames = new Map(
      fuzzyMatches.map(({ id, matchedItemNames }) => [
        id,
        new Set(matchedItemNames.map((name) => name.toLocaleLowerCase())),
      ]),
    );
    const fuzzyRestaurantIds = fuzzyMatches.map(({ id }) => id);
    const itemWhere: Prisma.MenuItemWhereInput = {
      isAvailable: true,
      archivedAt: null,
      AND: [{ OR: [{ categoryId: null }, { category: { is: { isActive: true } } }] }],
      ...(filters.dietary ? { dietaryTags: { has: filters.dietary.trim() } } : {}),
      ...(filters.category
        ? {
            category: {
              is: {
                isActive: true,
                name: { equals: filters.category.trim(), mode: 'insensitive' },
              },
            },
          }
        : {}),
      ...(filters.minPriceMinor !== undefined || filters.maxPriceMinor !== undefined
        ? {
            priceMinor: {
              ...(filters.minPriceMinor !== undefined ? { gte: filters.minPriceMinor } : {}),
              ...(filters.maxPriceMinor !== undefined ? { lte: filters.maxPriceMinor } : {}),
            },
          }
        : {}),
    };
    const restaurantConditions: Prisma.RestaurantWhereInput[] = [];
    if (searchTerm) {
      restaurantConditions.push({
        OR: [
          { name: { contains: searchTerm, mode: 'insensitive' } },
          { description: { contains: searchTerm, mode: 'insensitive' } },
          { city: { contains: searchTerm, mode: 'insensitive' } },
          { cuisineTypes: { has: searchTerm } },
          ...(fuzzyRestaurantIds.length ? [{ id: { in: fuzzyRestaurantIds } }] : []),
          {
            items: {
              some: {
                isAvailable: true,
                archivedAt: null,
                AND: [
                  { OR: [{ categoryId: null }, { category: { is: { isActive: true } } }] },
                  {
                    OR: [
                      { name: { contains: searchTerm, mode: 'insensitive' } },
                      { description: { contains: searchTerm, mode: 'insensitive' } },
                    ],
                  },
                ],
              },
            },
          },
        ],
      });
    }
    if (
      filters.dietary ||
      filters.category ||
      filters.minPriceMinor !== undefined ||
      filters.maxPriceMinor !== undefined
    ) {
      restaurantConditions.push({ items: { some: itemWhere } });
    }
    if (filters.latitude !== undefined && filters.longitude !== undefined) {
      const radiusKm = filters.maxDistanceKm ?? 100;
      const latitudeDelta = radiusKm / 110.574;
      const cosineLatitude = Math.cos((filters.latitude * Math.PI) / 180);
      const longitudeDelta =
        Math.abs(cosineLatitude) < 0.1
          ? 180
          : Math.min(180, radiusKm / (111.32 * Math.abs(cosineLatitude)));
      const minimumLongitude = filters.longitude - longitudeDelta;
      const maximumLongitude = filters.longitude + longitudeDelta;
      const longitudeCondition: Prisma.RestaurantWhereInput =
        longitudeDelta === 180
          ? { longitude: { not: null } }
          : minimumLongitude < -180
            ? {
                OR: [
                  { longitude: { gte: minimumLongitude + 360 } },
                  { longitude: { lte: maximumLongitude } },
                ],
              }
            : maximumLongitude > 180
              ? {
                  OR: [
                    { longitude: { gte: minimumLongitude } },
                    { longitude: { lte: maximumLongitude - 360 } },
                  ],
                }
              : {
                  longitude: {
                    gte: minimumLongitude,
                    lte: maximumLongitude,
                  },
                };
      restaurantConditions.push({
        latitude: {
          not: null,
          gte: Math.max(-90, filters.latitude - latitudeDelta),
          lte: Math.min(90, filters.latitude + latitudeDelta),
        },
        ...longitudeCondition,
      });
    }

    const restaurants = await this.prisma.restaurant.findMany({
      where: {
        status: 'ACTIVE',
        ...(filters.city ? { city: { equals: filters.city.trim(), mode: 'insensitive' } } : {}),
        ...(filters.cuisine ? { cuisineTypes: { has: filters.cuisine.trim() } } : {}),
        ...(filters.minRating !== undefined
          ? { ratingSnapshot: { is: { averageRating: { gte: filters.minRating } } } }
          : {}),
        ...(filters.maxEtaMinutes !== undefined
          ? { estimatedEtaMaxMinutes: { lte: filters.maxEtaMinutes } }
          : {}),
        ...(filters.hasOffer === 'true'
          ? { offers: { some: activeOfferWhere } }
          : filters.hasOffer === 'false'
            ? { offers: { none: activeOfferWhere } }
            : {}),
        ...(restaurantConditions.length ? { AND: restaurantConditions } : {}),
      },
      select: {
        ...restaurantPublicFields,
        latitude: true,
        longitude: true,
        serviceRadiusKm: true,
        items: {
          where: itemWhere,
          select: { name: true, description: true, priceMinor: true, currency: true },
          orderBy: { priceMinor: 'asc' },
          take: searchTerm ? 20 : 100,
        },
        offers: {
          where: activeOfferWhere,
          select: {
            id: true,
            title: true,
            description: true,
            terms: true,
            redemptionInstructions: true,
            validFrom: true,
            validUntil: true,
          },
          orderBy: { validUntil: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
      take: searchTerm ? 1000 : 500,
    });

    let results = restaurants.map((restaurant) => {
      const {
        latitude,
        longitude,
        serviceRadiusKm,
        items,
        ratingSnapshot,
        offers,
        ...publicRestaurant
      } = restaurant;
      const distanceKm =
        filters.latitude !== undefined &&
        filters.longitude !== undefined &&
        latitude !== null &&
        longitude !== null
          ? distanceInKm(filters.latitude, filters.longitude, latitude, longitude)
          : null;
      const matchedItems = searchTerm
        ? items.filter(
            (item) =>
              [item.name, item.description ?? ''].some((value) =>
                value.toLocaleLowerCase().includes(searchTerm.toLocaleLowerCase()),
              ) || fuzzyItemNames.get(restaurant.id)?.has(item.name.toLocaleLowerCase()),
          )
        : [];
      return {
        ...publicRestaurant,
        ratingAverage: ratingSnapshot?.averageRating ?? null,
        ratingCount: ratingSnapshot?.reviewCount ?? 0,
        ratingSource: ratingSnapshot?.source ?? null,
        activeOffers: offers ?? [],
        isAcceptingOrders: isRestaurantOpen(restaurant),
        distanceKm: distanceKm === null ? null : Math.round(distanceKm * 10) / 10,
        minimumPriceMinor: items[0]?.priceMinor ?? null,
        matchedItems,
        isServiceable: distanceKm !== null && distanceKm <= serviceRadiusKm,
      };
    });

    if (filters.latitude !== undefined && filters.longitude !== undefined) {
      results = results.filter(
        (restaurant) =>
          restaurant.isServiceable &&
          (filters.maxDistanceKm === undefined || restaurant.distanceKm! <= filters.maxDistanceKm),
      );
    }
    if (filters.availability === 'open') {
      results = results.filter((restaurant) => restaurant.isAcceptingOrders);
    } else if (filters.availability === 'closed') {
      results = results.filter((restaurant) => !restaurant.isAcceptingOrders);
    }

    if (sort === 'distance') {
      results.sort((left, right) => (left.distanceKm ?? Infinity) - (right.distanceKm ?? Infinity));
    } else if (sort === 'rating') {
      results.sort((left, right) => {
        if (left.ratingAverage === null) return right.ratingAverage === null ? 0 : 1;
        if (right.ratingAverage === null) return -1;
        return right.ratingAverage - left.ratingAverage;
      });
    } else if (sort === 'eta') {
      results.sort((left, right) => {
        if (left.estimatedEtaMaxMinutes == null)
          return right.estimatedEtaMaxMinutes == null ? 0 : 1;
        if (right.estimatedEtaMaxMinutes == null) return -1;
        return left.estimatedEtaMaxMinutes - right.estimatedEtaMaxMinutes;
      });
    } else if (sort === 'price_asc' || sort === 'price_desc') {
      const direction = sort === 'price_asc' ? 1 : -1;
      results.sort((left, right) => {
        if (left.minimumPriceMinor === null) return right.minimumPriceMinor === null ? 0 : 1;
        if (right.minimumPriceMinor === null) return -1;
        return (left.minimumPriceMinor - right.minimumPriceMinor) * direction;
      });
    } else if (sort === 'relevance' && searchTerm) {
      const term = searchTerm.toLocaleLowerCase();
      results.sort((left, right) => {
        const score = (restaurant: (typeof results)[number]) =>
          restaurant.name.toLocaleLowerCase().includes(term)
            ? 0
            : restaurant.matchedItems.length
              ? 1
              : restaurant.cuisineTypes.some((cuisine) =>
                    cuisine.toLocaleLowerCase().includes(term),
                  )
                ? 2
                : 3;
        return score(left) - score(right) || left.name.localeCompare(right.name);
      });
    }

    if (userId && results.length) {
      const favorites = await this.prisma.restaurantFavorite.findMany({
        where: { userId, restaurantId: { in: results.map(({ id }) => id) } },
        select: { restaurantId: true },
      });
      const favoriteIds = new Set(favorites.map(({ restaurantId }) => restaurantId));
      results = results.map((restaurant) => ({
        ...restaurant,
        isFavorite: favoriteIds.has(restaurant.id),
      }));
    }

    const offset = filters.offset ?? 0;
    return results.slice(offset, offset + (filters.limit ?? 50));
  }

  async listDiscoveryFacets() {
    const [restaurants, categories, items] = await Promise.all([
      this.prisma.restaurant.findMany({
        where: { status: 'ACTIVE' },
        select: { cuisineTypes: true },
      }),
      this.prisma.menuCategory.findMany({
        where: { isActive: true, restaurant: { is: { status: 'ACTIVE' } } },
        select: { name: true },
        distinct: ['name'],
        orderBy: { name: 'asc' },
      }),
      this.prisma.menuItem.findMany({
        where: { isAvailable: true, archivedAt: null, restaurant: { is: { status: 'ACTIVE' } } },
        select: { dietaryTags: true },
      }),
    ]);
    return {
      cuisines: [...new Set(restaurants.flatMap(({ cuisineTypes }) => cuisineTypes))].sort(),
      categories: categories.map(({ name }) => name),
      dietaryTags: [...new Set(items.flatMap(({ dietaryTags }) => dietaryTags))].sort(),
    };
  }

  listFavorites(userId: string) {
    return this.prisma.restaurantFavorite
      .findMany({
        where: { userId, restaurant: { status: 'ACTIVE' } },
        orderBy: { createdAt: 'desc' },
        select: { restaurantId: true },
      })
      .then((favorites) => favorites.map(({ restaurantId }) => restaurantId));
  }

  async addFavorite(userId: string, restaurantId: string) {
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!restaurant) throw new NotFoundException('Restaurant not found');
    await this.prisma.restaurantFavorite.upsert({
      where: { userId_restaurantId: { userId, restaurantId } },
      create: { userId, restaurantId },
      update: {},
    });
    return { isFavorite: true };
  }

  async removeFavorite(userId: string, restaurantId: string) {
    await this.prisma.restaurantFavorite.deleteMany({ where: { userId, restaurantId } });
    return { isFavorite: false };
  }

  async getPublic(id: string) {
    const now = new Date();
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id, status: 'ACTIVE' },
      select: {
        ...restaurantPublicFields,
        offers: {
          where: { isActive: true, validFrom: { lte: now }, validUntil: { gte: now } },
          select: currentOfferSelect,
          orderBy: { validUntil: 'asc' },
        },
      },
    });
    if (!restaurant) throw new NotFoundException('Restaurant not found');
    const { ratingSnapshot, offers, ...publicRestaurant } = restaurant;
    return {
      ...publicRestaurant,
      isAcceptingOrders: isRestaurantOpen(restaurant),
      ratingAverage: ratingSnapshot?.averageRating ?? null,
      ratingCount: ratingSnapshot?.reviewCount ?? 0,
      ratingSource: ratingSnapshot?.source ?? null,
      activeOffers: offers,
    };
  }

  async getPublicMenu(id: string) {
    const now = new Date();
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id, status: 'ACTIVE' },
      select: {
        ...restaurantPublicFields,
        offers: {
          where: { isActive: true, validFrom: { lte: now }, validUntil: { gte: now } },
          select: currentOfferSelect,
          orderBy: { validUntil: 'asc' },
        },
        categories: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          include: {
            items: {
              where: { isAvailable: true, archivedAt: null },
              orderBy: { sortOrder: 'asc' },
              include: {
                optionGroups: {
                  orderBy: { sortOrder: 'asc' },
                  include: {
                    options: {
                      where: { isAvailable: true },
                      orderBy: { sortOrder: 'asc' },
                    },
                  },
                },
              },
            },
          },
        },
        items: {
          where: { categoryId: null, isAvailable: true, archivedAt: null },
          orderBy: { sortOrder: 'asc' },
          include: {
            optionGroups: {
              orderBy: { sortOrder: 'asc' },
              include: {
                options: { where: { isAvailable: true }, orderBy: { sortOrder: 'asc' } },
              },
            },
          },
        },
      },
    });
    if (!restaurant) throw new NotFoundException('Restaurant not found');
    const { ratingSnapshot, offers, ...publicRestaurant } = restaurant;
    return {
      ...publicRestaurant,
      isAcceptingOrders: isRestaurantOpen(restaurant),
      ratingAverage: ratingSnapshot?.averageRating ?? null,
      ratingCount: ratingSnapshot?.reviewCount ?? 0,
      ratingSource: ratingSnapshot?.source ?? null,
      activeOffers: offers,
    };
  }

  listPartner(user: AuthenticatedUser) {
    return this.prisma.userRole
      .findMany({
        where: {
          userId: user.id,
          scopeType: 'RESTAURANT',
          status: 'ACTIVE',
          role: { in: ['restaurant_owner', 'restaurant_staff'] },
          scopeId: { not: null },
        },
        select: { scopeId: true },
      })
      .then((assignments) =>
        this.prisma.restaurant.findMany({
          where: { id: { in: assignments.flatMap(({ scopeId }) => (scopeId ? [scopeId] : [])) } },
          orderBy: { createdAt: 'desc' },
          include: { hours: { orderBy: { dayOfWeek: 'asc' } } },
        }),
      );
  }

  async create(user: AuthenticatedUser, input: CreateRestaurantDto, correlationId?: string) {
    if ((input.latitude === undefined) !== (input.longitude === undefined)) {
      throw new BadRequestException('Latitude and longitude must be provided together');
    }
    if (
      (input.estimatedEtaMinMinutes === undefined) !==
      (input.estimatedEtaMaxMinutes === undefined)
    ) {
      throw new BadRequestException('Both ETA bounds must be provided together');
    }
    if (
      input.estimatedEtaMinMinutes !== undefined &&
      input.estimatedEtaMaxMinutes !== undefined &&
      input.estimatedEtaMinMinutes > input.estimatedEtaMaxMinutes
    ) {
      throw new BadRequestException('Minimum ETA cannot exceed maximum ETA');
    }
    const slugBase = input.name
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48);
    const slug = `${slugBase || 'restaurant'}-${randomUUID().slice(0, 8)}`;
    const duplicate = await this.prisma.restaurant.findFirst({
      where: {
        createdByUserId: user.id,
        name: input.name.trim(),
        addressLine1: input.addressLine1.trim(),
        postalCode: input.postalCode.trim(),
        status: { in: ['PENDING', 'ACTIVE'] },
      },
      select: { id: true },
    });
    if (duplicate) throw new ConflictException('This restaurant has already been submitted');
    return this.prisma.$transaction(async (transaction) => {
      const restaurant = await transaction.restaurant.create({
        data: {
          ...input,
          name: input.name.trim(),
          city: input.city.trim(),
          state: input.state.trim(),
          slug,
          createdByUserId: user.id,
          status: 'PENDING',
          isAcceptingOrders: false,
          hours: {
            create: Array.from({ length: 7 }, (_, dayOfWeek) => ({
              dayOfWeek,
              openTime: '09:00',
              closeTime: '21:00',
              isClosed: true,
            })),
          },
        },
      });
      await transaction.userRole.create({
        data: {
          userId: user.id,
          role: 'restaurant_owner',
          scopeType: 'RESTAURANT',
          scopeId: restaurant.id,
          grantedByUserId: user.id,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: user.id,
          permission: 'restaurant.onboard',
          action: 'RESTAURANT_SUBMITTED',
          entityType: 'restaurant',
          entityId: restaurant.id,
          after: { name: restaurant.name, status: restaurant.status },
          correlationId,
        },
      });
      return restaurant;
    });
  }

  async getPartner(id: string) {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id },
      include: { hours: { orderBy: { dayOfWeek: 'asc' } } },
    });
    if (!restaurant) throw new NotFoundException('Restaurant not found');
    return restaurant;
  }

  async updateHours(
    actor: AuthenticatedUser,
    restaurantId: string,
    input: UpdateRestaurantHoursDto,
    correlationId?: string,
  ) {
    const days = [...input.days].sort((left, right) => left.dayOfWeek - right.dayOfWeek);
    if (days.some((day, index) => day.dayOfWeek !== index)) {
      throw new BadRequestException('Hours must include each weekday exactly once');
    }
    return this.prisma.$transaction(async (transaction) => {
      const restaurant = await transaction.restaurant.findUnique({ where: { id: restaurantId } });
      if (!restaurant) throw new NotFoundException('Restaurant not found');
      const before = await transaction.restaurantHours.findMany({
        where: { restaurantId },
        orderBy: { dayOfWeek: 'asc' },
      });
      await transaction.restaurantHours.deleteMany({ where: { restaurantId } });
      const hours = await transaction.restaurantHours.createMany({
        data: days.map((day) => ({ ...day, restaurantId })),
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: actor.id,
          permission: 'restaurant.manage',
          action: 'RESTAURANT_HOURS_UPDATED',
          entityType: 'restaurant',
          entityId: restaurantId,
          before: before as unknown as Prisma.InputJsonValue,
          after: days as unknown as Prisma.InputJsonValue,
          correlationId,
        },
      });
      return { updated: hours.count, days };
    });
  }

  async updatePartner(
    actor: AuthenticatedUser,
    id: string,
    input: UpdateRestaurantDto,
    correlationId?: string,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const before = await transaction.restaurant.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Restaurant not found');
      const latitude = input.latitude ?? before.latitude;
      const longitude = input.longitude ?? before.longitude;
      if ((latitude === null) !== (longitude === null)) {
        throw new BadRequestException('Latitude and longitude must be provided together');
      }
      const etaMin =
        input.estimatedEtaMinMinutes === undefined
          ? before.estimatedEtaMinMinutes
          : input.estimatedEtaMinMinutes;
      const etaMax =
        input.estimatedEtaMaxMinutes === undefined
          ? before.estimatedEtaMaxMinutes
          : input.estimatedEtaMaxMinutes;
      if (
        (etaMin === null) !== (etaMax === null) ||
        (etaMin !== null && etaMax !== null && etaMin > etaMax)
      ) {
        throw new BadRequestException(
          'ETA bounds must be provided together and minimum cannot exceed maximum',
        );
      }
      const updated = await transaction.restaurant.update({
        where: { id },
        data: {
          ...input,
          ...(input.name ? { name: input.name.trim() } : {}),
          ...(input.city ? { city: input.city.trim() } : {}),
          ...(input.state ? { state: input.state.trim() } : {}),
          ...(before.status !== 'ACTIVE' ? { isAcceptingOrders: false } : {}),
        },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: actor.id,
          permission: 'restaurant.manage',
          action: 'RESTAURANT_UPDATED',
          entityType: 'restaurant',
          entityId: id,
          before: {
            name: before.name,
            city: before.city,
            isAcceptingOrders: before.isAcceptingOrders,
          },
          after: {
            name: updated.name,
            city: updated.city,
            isAcceptingOrders: updated.isAcceptingOrders,
          },
          correlationId,
        },
      });
      return updated;
    });
  }

  async listPartnerOffers(restaurantId: string) {
    await this.ensureRestaurant(restaurantId);
    return this.prisma.restaurantOffer.findMany({
      where: { restaurantId },
      orderBy: [{ isActive: 'desc' }, { validUntil: 'desc' }],
    });
  }

  async createPartnerOffer(
    actor: AuthenticatedUser,
    restaurantId: string,
    input: CreateRestaurantOfferDto,
    correlationId?: string,
  ) {
    const validFrom = new Date(input.validFrom);
    const validUntil = new Date(input.validUntil);
    if (validFrom >= validUntil) throw new BadRequestException('Offer end must be after its start');
    return this.prisma.$transaction(async (transaction) => {
      const restaurant = await transaction.restaurant.findUnique({ where: { id: restaurantId } });
      if (!restaurant) throw new NotFoundException('Restaurant not found');
      const offer = await transaction.restaurantOffer.create({
        data: {
          restaurantId,
          createdByUserId: actor.id,
          title: input.title.trim(),
          description: input.description.trim(),
          terms: input.terms?.trim() || null,
          redemptionInstructions: input.redemptionInstructions.trim(),
          validFrom,
          validUntil,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: actor.id,
          permission: 'restaurant.manage',
          action: 'RESTAURANT_OFFER_CREATED',
          entityType: 'restaurant_offer',
          entityId: offer.id,
          after: { restaurantId, title: offer.title, validFrom, validUntil },
          correlationId,
        },
      });
      return offer;
    });
  }

  async disablePartnerOffer(
    actor: AuthenticatedUser,
    restaurantId: string,
    offerId: string,
    correlationId?: string,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const offer = await transaction.restaurantOffer.findFirst({
        where: { id: offerId, restaurantId },
      });
      if (!offer) throw new NotFoundException('Restaurant offer not found');
      if (!offer.isActive) return offer;
      const disabled = await transaction.restaurantOffer.update({
        where: { id: offerId },
        data: { isActive: false },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: actor.id,
          permission: 'restaurant.manage',
          action: 'RESTAURANT_OFFER_DISABLED',
          entityType: 'restaurant_offer',
          entityId: offerId,
          before: { isActive: offer.isActive },
          after: { isActive: disabled.isActive },
          correlationId,
        },
      });
      return disabled;
    });
  }

  async updateRatingSnapshot(
    actor: AuthenticatedUser,
    restaurantId: string,
    input: UpdateRestaurantRatingDto,
    correlationId?: string,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const restaurant = await transaction.restaurant.findUnique({ where: { id: restaurantId } });
      if (!restaurant) throw new NotFoundException('Restaurant not found');
      const before = await transaction.restaurantRatingSnapshot.findUnique({
        where: { restaurantId },
      });
      const snapshot = await transaction.restaurantRatingSnapshot.upsert({
        where: { restaurantId },
        create: { restaurantId, ...input },
        update: input,
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: actor.id,
          permission: 'admin.restaurants.manage',
          action: 'RESTAURANT_RATING_SNAPSHOT_UPDATED',
          entityType: 'restaurant_rating_snapshot',
          entityId: snapshot.id,
          before: before
            ? {
                averageRating: before.averageRating,
                reviewCount: before.reviewCount,
                source: before.source,
              }
            : Prisma.JsonNull,
          after: {
            averageRating: snapshot.averageRating,
            reviewCount: snapshot.reviewCount,
            source: snapshot.source,
          },
          correlationId,
        },
      });
      return snapshot;
    });
  }

  async approve(actor: AuthenticatedUser, id: string, correlationId?: string) {
    return this.prisma.$transaction(async (transaction) => {
      const restaurant = await transaction.restaurant.findUnique({ where: { id } });
      if (!restaurant) throw new NotFoundException('Restaurant not found');
      if (restaurant.createdByUserId === actor.id) {
        throw new BadRequestException('Restaurant owners cannot approve their own submissions');
      }
      if (restaurant.status === 'ACTIVE') return restaurant;
      if (restaurant.status !== 'PENDING') {
        throw new BadRequestException('Only pending restaurants can be approved');
      }
      const approved = await transaction.restaurant.update({
        where: { id },
        data: { status: 'ACTIVE' },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: actor.id,
          permission: 'admin.restaurants.manage',
          action: 'RESTAURANT_APPROVED',
          entityType: 'restaurant',
          entityId: id,
          before: { status: restaurant.status },
          after: { status: approved.status },
          correlationId,
        },
      });
      return approved;
    });
  }

  async listPartnerMenu(id: string) {
    await this.ensureRestaurant(id);
    const [categories, uncategorized] = await Promise.all([
      this.prisma.menuCategory.findMany({
        where: { restaurantId: id },
        orderBy: { sortOrder: 'asc' },
        include: {
          items: {
            where: { archivedAt: null },
            orderBy: { sortOrder: 'asc' },
            include: {
              optionGroups: { include: { options: true }, orderBy: { sortOrder: 'asc' } },
            },
          },
        },
      }),
      this.prisma.menuItem.findMany({
        where: { restaurantId: id, categoryId: null, archivedAt: null },
        orderBy: { sortOrder: 'asc' },
        include: { optionGroups: { include: { options: true }, orderBy: { sortOrder: 'asc' } } },
      }),
    ]);
    return uncategorized.length
      ? [
          ...categories,
          { id: 'uncategorized', name: 'Uncategorized', isActive: true, items: uncategorized },
        ]
      : categories;
  }

  async createCategory(
    actor: AuthenticatedUser,
    restaurantId: string,
    input: CreateCategoryDto,
    correlationId?: string,
  ) {
    await this.ensureRestaurant(restaurantId);
    return this.prisma.$transaction(async (transaction) => {
      const category = await transaction.menuCategory.create({
        data: { ...input, name: input.name.trim(), restaurantId },
      });
      await this.auditMenu(
        actor,
        transaction,
        restaurantId,
        category.id,
        'MENU_CATEGORY_CREATED',
        category,
        correlationId,
      );
      return category;
    });
  }

  async updateCategory(
    actor: AuthenticatedUser,
    restaurantId: string,
    categoryId: string,
    input: UpdateCategoryDto,
    correlationId?: string,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const category = await transaction.menuCategory.findFirst({
        where: { id: categoryId, restaurantId },
      });
      if (!category) throw new NotFoundException('Menu category not found');
      const updated = await transaction.menuCategory.update({
        where: { id: categoryId },
        data: { ...input, ...(input.name ? { name: input.name.trim() } : {}) },
      });
      await this.auditMenu(
        actor,
        transaction,
        restaurantId,
        categoryId,
        'MENU_CATEGORY_UPDATED',
        { before: category, after: updated },
        correlationId,
      );
      return updated;
    });
  }

  async createMenuItem(
    actor: AuthenticatedUser,
    restaurantId: string,
    input: CreateMenuItemDto,
    correlationId?: string,
  ) {
    await this.ensureRestaurant(restaurantId);
    if (input.categoryId) {
      const category = await this.prisma.menuCategory.findFirst({
        where: { id: input.categoryId, restaurantId, isActive: true },
        select: { id: true },
      });
      if (!category)
        throw new BadRequestException('Category must belong to this restaurant and be active');
    }
    for (const group of input.optionGroups ?? []) {
      const minimum = group.minSelections ?? 0;
      const maximum = group.maxSelections ?? 1;
      if (minimum > maximum || maximum > group.options.length) {
        throw new BadRequestException('Option group selection limits do not match its options');
      }
    }

    return this.prisma.$transaction(async (transaction) => {
      const { optionGroups = [], ...itemInput } = input;
      const item = await transaction.menuItem.create({
        data: {
          ...itemInput,
          restaurantId,
          currency: (input.currency ?? 'INR').toUpperCase(),
          optionGroups: {
            create: optionGroups.map((group) => ({
              name: group.name.trim(),
              minSelections: group.minSelections ?? 0,
              maxSelections: group.maxSelections ?? 1,
              options: {
                create: group.options.map((option) => ({
                  name: option.name.trim(),
                  priceDeltaMinor: option.priceDeltaMinor ?? 0,
                })),
              },
            })),
          },
        },
        include: { optionGroups: { include: { options: true } } },
      });
      await this.auditMenu(
        actor,
        transaction,
        restaurantId,
        item.id,
        'MENU_ITEM_CREATED',
        item,
        correlationId,
      );
      return item;
    });
  }

  async setItemAvailability(
    actor: AuthenticatedUser,
    restaurantId: string,
    itemId: string,
    isAvailable: boolean,
    correlationId?: string,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const item = await transaction.menuItem.findFirst({
        where: { id: itemId, restaurantId, archivedAt: null },
      });
      if (!item) throw new NotFoundException('Menu item not found');
      const updated = await transaction.menuItem.update({
        where: { id: itemId },
        data: { isAvailable },
      });
      await this.auditMenu(
        actor,
        transaction,
        restaurantId,
        itemId,
        'MENU_ITEM_AVAILABILITY_CHANGED',
        { isAvailable },
        correlationId,
      );
      return updated;
    });
  }

  async updateMenuItem(
    actor: AuthenticatedUser,
    restaurantId: string,
    itemId: string,
    input: UpdateMenuItemDto,
    correlationId?: string,
  ) {
    if (input.categoryId) {
      const category = await this.prisma.menuCategory.findFirst({
        where: { id: input.categoryId, restaurantId, isActive: true },
        select: { id: true },
      });
      if (!category)
        throw new BadRequestException('Category must belong to this restaurant and be active');
    }
    return this.prisma.$transaction(async (transaction) => {
      const item = await transaction.menuItem.findFirst({
        where: { id: itemId, restaurantId, archivedAt: null },
      });
      if (!item) throw new NotFoundException('Menu item not found');
      const updated = await transaction.menuItem.update({
        where: { id: itemId },
        data: {
          ...input,
          ...(input.name ? { name: input.name.trim() } : {}),
          ...(input.currency ? { currency: input.currency.toUpperCase() } : {}),
        },
      });
      await this.auditMenu(
        actor,
        transaction,
        restaurantId,
        itemId,
        'MENU_ITEM_UPDATED',
        { before: item, after: updated },
        correlationId,
      );
      return updated;
    });
  }

  async archiveMenuItem(
    actor: AuthenticatedUser,
    restaurantId: string,
    itemId: string,
    correlationId?: string,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const item = await transaction.menuItem.findFirst({ where: { id: itemId, restaurantId } });
      if (!item) throw new NotFoundException('Menu item not found');
      if (item.archivedAt) return { archived: true };
      await transaction.menuItem.update({
        where: { id: itemId },
        data: { archivedAt: new Date(), isAvailable: false },
      });
      await this.auditMenu(
        actor,
        transaction,
        restaurantId,
        itemId,
        'MENU_ITEM_ARCHIVED',
        { archivedAt: new Date().toISOString() },
        correlationId,
      );
      return { archived: true };
    });
  }

  private async ensureRestaurant(id: string) {
    if (!(await this.prisma.restaurant.findUnique({ where: { id }, select: { id: true } }))) {
      throw new NotFoundException('Restaurant not found');
    }
  }

  private auditMenu(
    actor: AuthenticatedUser,
    transaction: Prisma.TransactionClient,
    restaurantId: string,
    entityId: string,
    action: string,
    after: Prisma.InputJsonValue,
    correlationId?: string,
  ) {
    return transaction.auditLog.create({
      data: {
        actorUserId: actor.id,
        permission: 'restaurant.menu.manage',
        action,
        entityType: 'restaurant_menu',
        entityId,
        after: { restaurantId, value: after },
        correlationId,
      },
    });
  }
}
