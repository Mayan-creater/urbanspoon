import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface MenuOptionFixture {
  name: string;
  priceDeltaMinor: number;
}

interface MenuItemFixture {
  id: string;
  name: string;
  description: string;
  priceMinor: number;
  dietaryTags: string[];
  optionGroup?: {
    name: string;
    minSelections: number;
    options: MenuOptionFixture[];
  };
}

interface MenuCategoryFixture {
  name: string;
  description: string;
  items: MenuItemFixture[];
}

interface OfferFixture {
  id: string;
  title: string;
  description: string;
  terms: string;
  redemptionInstructions: string;
  startDaysFromToday: number;
  durationDays: number;
}

interface RestaurantFixture {
  id: string;
  slug: string;
  name: string;
  description: string;
  cuisineTypes: string[];
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  latitude: number;
  longitude: number;
  serviceRadiusKm: number;
  estimatedEtaMinMinutes: number;
  estimatedEtaMaxMinutes: number;
  ratingAverage: number;
  ratingCount: number;
  isAcceptingOrders: boolean;
  offers: OfferFixture[];
  categories: MenuCategoryFixture[];
}

const restaurants: RestaurantFixture[] = [
  {
    id: '22000000-0000-4000-8000-000000000001',
    slug: 'demo-spice-route-kitchen',
    name: 'Spice Route Kitchen',
    description: 'Regional Indian plates, slow-cooked curries, and fresh breads.',
    cuisineTypes: ['Indian', 'North Indian'],
    addressLine1: '18 FC Road',
    city: 'Pune',
    state: 'Maharashtra',
    postalCode: '411004',
    latitude: 18.5204,
    longitude: 73.8567,
    serviceRadiusKm: 12,
    estimatedEtaMinMinutes: 30,
    estimatedEtaMaxMinutes: 40,
    ratingAverage: 4.7,
    ratingCount: 128,
    isAcceptingOrders: true,
    offers: [
      {
        id: '44000000-0000-4000-8000-000000000001',
        title: 'Complimentary naan with a curry',
        description: 'Add one plain naan at no extra charge with any main course.',
        terms: 'One naan per order. While daily naan stocks last.',
        redemptionInstructions: 'Mention the offer when placing your order.',
        startDaysFromToday: -1,
        durationDays: 30,
      },
    ],
    categories: [
      {
        name: 'Mains',
        description: 'House favorites from the tandoor and curry pot.',
        items: [
          {
            id: '33000000-0000-4000-8000-000000000001',
            name: 'Paneer Tikka Masala',
            description: 'Charred paneer in a tomato and cashew gravy.',
            priceMinor: 28900,
            dietaryTags: ['vegetarian', 'gluten-free'],
            optionGroup: {
              name: 'Choose a portion',
              minSelections: 1,
              options: [
                { name: 'Regular', priceDeltaMinor: 0 },
                { name: 'Large', priceDeltaMinor: 9000 },
              ],
            },
          },
          {
            id: '33000000-0000-4000-8000-000000000002',
            name: 'Masala Dosa',
            description: 'Crisp rice crepe with potato masala and coconut chutney.',
            priceMinor: 14500,
            dietaryTags: ['vegetarian', 'dairy-free'],
          },
        ],
      },
    ],
  },
  {
    id: '22000000-0000-4000-8000-000000000002',
    slug: 'demo-slice-society',
    name: 'Slice Society',
    description: 'Hand-stretched sourdough pizza with seasonal toppings.',
    cuisineTypes: ['Italian', 'Pizza'],
    addressLine1: '42 Koregaon Park Road',
    city: 'Pune',
    state: 'Maharashtra',
    postalCode: '411001',
    latitude: 18.5362,
    longitude: 73.8939,
    serviceRadiusKm: 10,
    estimatedEtaMinMinutes: 35,
    estimatedEtaMaxMinutes: 45,
    ratingAverage: 4.5,
    ratingCount: 82,
    isAcceptingOrders: true,
    offers: [
      {
        id: '44000000-0000-4000-8000-000000000002',
        title: 'Free garlic dip',
        description: 'Receive one house garlic dip with a large pizza.',
        terms: 'One dip per qualifying pizza.',
        redemptionInstructions: 'Add a large pizza and request the garlic dip.',
        startDaysFromToday: -1,
        durationDays: 21,
      },
    ],
    categories: [
      {
        name: 'Pizza',
        description: 'Stone-baked, 48-hour fermented dough.',
        items: [
          {
            id: '33000000-0000-4000-8000-000000000003',
            name: 'Margherita Pizza',
            description: 'San Marzano tomato, mozzarella, basil, and olive oil.',
            priceMinor: 42500,
            dietaryTags: ['vegetarian'],
            optionGroup: {
              name: 'Size',
              minSelections: 1,
              options: [
                { name: 'Personal', priceDeltaMinor: 0 },
                { name: 'Large', priceDeltaMinor: 16000 },
              ],
            },
          },
          {
            id: '33000000-0000-4000-8000-000000000004',
            name: 'Roasted Garden Pizza',
            description: 'Roasted peppers, mushrooms, olives, and plant-based cheese.',
            priceMinor: 48900,
            dietaryTags: ['vegan', 'dairy-free'],
          },
        ],
      },
    ],
  },
  {
    id: '22000000-0000-4000-8000-000000000003',
    slug: 'demo-green-fork-cafe',
    name: 'Green Fork Cafe',
    description: 'Bright grain bowls and cold-pressed drinks made to order.',
    cuisineTypes: ['Healthy', 'Vegan'],
    addressLine1: '7 Prabhat Road',
    city: 'Pune',
    state: 'Maharashtra',
    postalCode: '411004',
    latitude: 18.5088,
    longitude: 73.8312,
    serviceRadiusKm: 8,
    estimatedEtaMinMinutes: 25,
    estimatedEtaMaxMinutes: 35,
    ratingAverage: 4.8,
    ratingCount: 56,
    isAcceptingOrders: true,
    offers: [
      {
        id: '44000000-0000-4000-8000-000000000003',
        title: 'Complimentary lemon cooler',
        description: 'A small lemon cooler with any plant-based bowl.',
        terms: 'While daily cooler stocks last.',
        redemptionInstructions: 'Request the cooler with your bowl order.',
        startDaysFromToday: -1,
        durationDays: 14,
      },
    ],
    categories: [
      {
        name: 'Plant-based bowls',
        description: 'Balanced bowls with house-made dressings.',
        items: [
          {
            id: '33000000-0000-4000-8000-000000000005',
            name: 'Vegan Protein Bowl',
            description: 'Quinoa, chickpeas, greens, avocado, and lemon tahini.',
            priceMinor: 31500,
            dietaryTags: ['vegan', 'dairy-free', 'gluten-free'],
          },
          {
            id: '33000000-0000-4000-8000-000000000006',
            name: 'Paneer Power Bowl',
            description: 'Grilled paneer, brown rice, greens, and mint dressing.',
            priceMinor: 33500,
            dietaryTags: ['vegetarian', 'gluten-free'],
          },
        ],
      },
    ],
  },
  {
    id: '22000000-0000-4000-8000-000000000004',
    slug: 'demo-night-owl-snacks',
    name: 'Night Owl Snacks',
    description: 'Street-style rolls, loaded fries, and late-night comfort food.',
    cuisineTypes: ['Street Food', 'Indian'],
    addressLine1: '11 Viman Nagar Main Road',
    city: 'Pune',
    state: 'Maharashtra',
    postalCode: '411014',
    latitude: 18.5679,
    longitude: 73.9143,
    serviceRadiusKm: 10,
    estimatedEtaMinMinutes: 30,
    estimatedEtaMaxMinutes: 50,
    ratingAverage: 4.3,
    ratingCount: 74,
    isAcceptingOrders: false,
    offers: [],
    categories: [
      {
        name: 'Rolls and wraps',
        description: 'Griddled wraps with house chutneys.',
        items: [
          {
            id: '33000000-0000-4000-8000-000000000007',
            name: 'Paneer Kathi Roll',
            description: 'Spiced paneer, onions, and mint chutney in a flaky paratha.',
            priceMinor: 18900,
            dietaryTags: ['vegetarian'],
          },
          {
            id: '33000000-0000-4000-8000-000000000008',
            name: 'Masala Fries',
            description: 'Crisp fries dusted with house chaat masala.',
            priceMinor: 9900,
            dietaryTags: ['vegan', 'dairy-free'],
          },
        ],
      },
    ],
  },
];

async function seedRestaurant(ownerId: string, fixture: RestaurantFixture) {
  await prisma.$transaction(async (transaction) => {
    const restaurant = await transaction.restaurant.upsert({
      where: { slug: fixture.slug },
      create: {
        id: fixture.id,
        slug: fixture.slug,
        name: fixture.name,
        description: fixture.description,
        cuisineTypes: fixture.cuisineTypes,
        addressLine1: fixture.addressLine1,
        city: fixture.city,
        state: fixture.state,
        postalCode: fixture.postalCode,
        latitude: fixture.latitude,
        longitude: fixture.longitude,
        serviceRadiusKm: fixture.serviceRadiusKm,
        estimatedEtaMinMinutes: fixture.estimatedEtaMinMinutes,
        estimatedEtaMaxMinutes: fixture.estimatedEtaMaxMinutes,
        status: 'ACTIVE',
        isAcceptingOrders: fixture.isAcceptingOrders,
        createdByUserId: ownerId,
      },
      update: {
        name: fixture.name,
        description: fixture.description,
        cuisineTypes: fixture.cuisineTypes,
        addressLine1: fixture.addressLine1,
        city: fixture.city,
        state: fixture.state,
        postalCode: fixture.postalCode,
        latitude: fixture.latitude,
        longitude: fixture.longitude,
        serviceRadiusKm: fixture.serviceRadiusKm,
        estimatedEtaMinMinutes: fixture.estimatedEtaMinMinutes,
        estimatedEtaMaxMinutes: fixture.estimatedEtaMaxMinutes,
        status: 'ACTIVE',
        isAcceptingOrders: fixture.isAcceptingOrders,
      },
    });

    await transaction.restaurantRatingSnapshot.upsert({
      where: { restaurantId: restaurant.id },
      create: {
        restaurantId: restaurant.id,
        averageRating: fixture.ratingAverage,
        reviewCount: fixture.ratingCount,
        source: 'Demo sample data',
      },
      update: {
        averageRating: fixture.ratingAverage,
        reviewCount: fixture.ratingCount,
        source: 'Demo sample data',
      },
    });

    for (const offerFixture of fixture.offers) {
      const validFrom = new Date();
      validFrom.setDate(validFrom.getDate() + offerFixture.startDaysFromToday);
      const validUntil = new Date(validFrom);
      validUntil.setDate(validUntil.getDate() + offerFixture.durationDays);
      await transaction.restaurantOffer.upsert({
        where: { id: offerFixture.id },
        create: {
          id: offerFixture.id,
          restaurantId: restaurant.id,
          createdByUserId: ownerId,
          title: offerFixture.title,
          description: offerFixture.description,
          terms: offerFixture.terms,
          redemptionInstructions: offerFixture.redemptionInstructions,
          validFrom,
          validUntil,
          isActive: true,
        },
        update: {
          restaurantId: restaurant.id,
          createdByUserId: ownerId,
          title: offerFixture.title,
          description: offerFixture.description,
          terms: offerFixture.terms,
          redemptionInstructions: offerFixture.redemptionInstructions,
          validFrom,
          validUntil,
          isActive: true,
        },
      });
    }

    await transaction.restaurantHours.deleteMany({ where: { restaurantId: restaurant.id } });
    await transaction.restaurantHours.createMany({
      data: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        restaurantId: restaurant.id,
        dayOfWeek,
        openTime: '00:00',
        closeTime: '23:59',
        isClosed: false,
      })),
    });

    const ownerRole = await transaction.userRole.findFirst({
      where: {
        userId: ownerId,
        role: 'restaurant_owner',
        scopeType: 'RESTAURANT',
        scopeId: restaurant.id,
        status: 'ACTIVE',
      },
    });
    if (!ownerRole) {
      await transaction.userRole.create({
        data: {
          userId: ownerId,
          role: 'restaurant_owner',
          scopeType: 'RESTAURANT',
          scopeId: restaurant.id,
          grantedByUserId: ownerId,
        },
      });
    }

    for (const [categoryIndex, categoryFixture] of fixture.categories.entries()) {
      const category = await transaction.menuCategory.upsert({
        where: { restaurantId_name: { restaurantId: restaurant.id, name: categoryFixture.name } },
        create: {
          restaurantId: restaurant.id,
          name: categoryFixture.name,
          description: categoryFixture.description,
          sortOrder: categoryIndex,
          isActive: true,
        },
        update: {
          description: categoryFixture.description,
          sortOrder: categoryIndex,
          isActive: true,
        },
      });

      for (const [itemIndex, itemFixture] of categoryFixture.items.entries()) {
        const item = await transaction.menuItem.upsert({
          where: { id: itemFixture.id },
          create: {
            id: itemFixture.id,
            restaurantId: restaurant.id,
            categoryId: category.id,
            name: itemFixture.name,
            description: itemFixture.description,
            priceMinor: itemFixture.priceMinor,
            currency: 'INR',
            dietaryTags: itemFixture.dietaryTags,
            isAvailable: true,
            sortOrder: itemIndex,
          },
          update: {
            restaurantId: restaurant.id,
            categoryId: category.id,
            name: itemFixture.name,
            description: itemFixture.description,
            priceMinor: itemFixture.priceMinor,
            currency: 'INR',
            dietaryTags: itemFixture.dietaryTags,
            isAvailable: true,
            archivedAt: null,
            sortOrder: itemIndex,
          },
        });

        await transaction.menuOptionGroup.deleteMany({ where: { itemId: item.id } });
        if (itemFixture.optionGroup) {
          await transaction.menuOptionGroup.create({
            data: {
              itemId: item.id,
              name: itemFixture.optionGroup.name,
              minSelections: itemFixture.optionGroup.minSelections,
              maxSelections: 1,
              options: { create: itemFixture.optionGroup.options },
            },
          });
        }
      }
    }
  });
}

async function main() {
  if (process.env.NODE_ENV === 'production' || process.env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error(
      'Demo seeding is disabled. Set ALLOW_DEMO_SEED=true in a non-production environment.',
    );
  }

  const owner = await prisma.user.upsert({
    where: { email: 'm3-demo-owner@urbanspoon.local' },
    create: {
      id: '11000000-0000-4000-8000-000000000001',
      name: 'Urban Spoon Demo Owner',
      email: 'm3-demo-owner@urbanspoon.local',
    },
    update: {},
  });

  const demoPricingRules = [
    {
      ruleKey: 'demo-delivery-fee',
      type: 'DELIVERY_FEE' as const,
      valueType: 'FIXED' as const,
      value: 4000,
      appliesTo: [] as string[],
      taxable: true,
      source: 'Local demo pricing; replace before production',
    },
    {
      ruleKey: 'demo-packaging-fee',
      type: 'PACKAGING_FEE' as const,
      valueType: 'FIXED' as const,
      value: 1000,
      appliesTo: [] as string[],
      taxable: true,
      source: 'Local demo pricing; replace before production',
    },
    {
      ruleKey: 'demo-service-fee',
      type: 'SERVICE_FEE' as const,
      valueType: 'PERCENTAGE' as const,
      value: 200,
      appliesTo: [] as string[],
      taxable: true,
      source: 'Local demo pricing; replace before production',
    },
    {
      ruleKey: 'demo-tax',
      type: 'TAX' as const,
      valueType: 'PERCENTAGE' as const,
      value: 500,
      appliesTo: ['ITEM_SUBTOTAL', 'DELIVERY_FEE', 'PACKAGING_FEE', 'SERVICE_FEE'],
      taxable: false,
      source: 'Demo only; tax treatment requires adviser confirmation',
    },
  ];
  const effectiveFrom = new Date();
  effectiveFrom.setFullYear(effectiveFrom.getFullYear() - 1);
  for (const rule of demoPricingRules) {
    await prisma.pricingRule.upsert({
      where: { ruleKey_version: { ruleKey: rule.ruleKey, version: 1 } },
      create: {
        ...rule,
        version: 1,
        currency: 'INR',
        scopeState: null,
        effectiveFrom,
        effectiveUntil: null,
        isActive: true,
      },
      update: {
        ...rule,
        currency: 'INR',
        effectiveFrom,
        effectiveUntil: null,
        isActive: true,
      },
    });
  }

  const couponStartsAt = new Date();
  couponStartsAt.setDate(couponStartsAt.getDate() - 1);
  const couponEndsAt = new Date();
  couponEndsAt.setFullYear(couponEndsAt.getFullYear() + 1);
  await prisma.coupon.upsert({
    where: { code: 'DEMO10' },
    create: {
      campaignKey: 'demo-welcome',
      campaignName: 'Demo welcome offer',
      code: 'DEMO10',
      discountType: 'PERCENTAGE',
      discountValue: 1000,
      minSubtotalMinor: 20000,
      maxDiscountMinor: 5000,
      usageLimit: 100,
      currency: 'INR',
      startsAt: couponStartsAt,
      endsAt: couponEndsAt,
      isActive: true,
    },
    update: {
      campaignKey: 'demo-welcome',
      campaignName: 'Demo welcome offer',
      discountType: 'PERCENTAGE',
      discountValue: 1000,
      minSubtotalMinor: 20000,
      maxDiscountMinor: 5000,
      usageLimit: 100,
      currency: 'INR',
      startsAt: couponStartsAt,
      endsAt: couponEndsAt,
      isActive: true,
    },
  });
  await prisma.coupon.upsert({
    where: { code: 'SLICE20' },
    create: {
      campaignKey: 'slice-night',
      campaignName: 'Slice night campaign',
      code: 'SLICE20',
      discountType: 'FIXED',
      discountValue: 2000,
      minSubtotalMinor: 50000,
      usageLimit: 50,
      currency: 'INR',
      restaurantId: restaurants[1].id,
      startsAt: couponStartsAt,
      endsAt: couponEndsAt,
      isActive: true,
    },
    update: {
      campaignKey: 'slice-night',
      campaignName: 'Slice night campaign',
      discountType: 'FIXED',
      discountValue: 2000,
      minSubtotalMinor: 50000,
      usageLimit: 50,
      currency: 'INR',
      restaurantId: restaurants[1].id,
      startsAt: couponStartsAt,
      endsAt: couponEndsAt,
      isActive: true,
    },
  });

  for (const restaurant of restaurants) {
    await seedRestaurant(owner.id, restaurant);
  }

  console.info(`Seeded ${restaurants.length} demo restaurants and M4 pricing examples in Pune.`);
}

main()
  .catch((error: unknown) => {
    console.error('Demo data seed failed.', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
