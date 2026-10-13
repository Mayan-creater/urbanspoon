import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiService } from './ai.service.js';

const config = {
  get: vi.fn((key: string) =>
    ({
      AI_API_BASE_URL: 'https://ai.example.test/v1',
      AI_API_KEY: 'test-key',
      AI_MODEL: 'test-model',
    })[key],
  ),
};

function providerResponse(content: unknown) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('AiService', () => {
  const candidate = {
    id: 'item-id',
    name: 'Vegetable bowl',
    description: 'Seasonal vegetables and rice',
    priceMinor: 450,
    currency: 'INR',
    dietaryTags: ['vegetarian'],
    restaurant: { id: 'restaurant-id', name: 'Local Kitchen', city: 'Pune', cuisineTypes: ['Indian'] },
  };
  const restaurants = { listPublic: vi.fn().mockResolvedValue([{ id: 'restaurant-id' }]) };
  const prisma = {
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    cart: { findFirst: vi.fn().mockResolvedValue(null) },
    menuItem: { create: vi.fn(), findMany: vi.fn().mockResolvedValue([candidate]) },
    order: { findMany: vi.fn().mockResolvedValue([]) },
    restaurant: { findFirst: vi.fn(), findUnique: vi.fn() },
    orderReview: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn() },
  };
  let service: AiService;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    config.get.mockImplementation((key: string) =>
      ({ AI_API_BASE_URL: 'https://ai.example.test/v1', AI_API_KEY: 'test-key', AI_MODEL: 'test-model' })[key],
    );
    restaurants.listPublic.mockResolvedValue([{ id: 'restaurant-id' }]);
    prisma.menuItem.findMany.mockResolvedValue([candidate]);
    prisma.auditLog.create.mockResolvedValue({});
    prisma.cart.findFirst.mockResolvedValue(null);
    prisma.order.findMany.mockResolvedValue([]);
    prisma.orderReview.findMany.mockResolvedValue([]);
    prisma.orderReview.count.mockResolvedValue(0);
    service = new AiService(config as never, prisma as never, restaurants as never);
  });

  it('returns canonical live item data instead of trusting model-supplied prices', async () => {
    vi.mocked(fetch).mockResolvedValue(
      providerResponse({
        answer: 'A vegetarian bowl fits.',
        suggestions: [{ restaurantId: 'restaurant-id', menuItemId: 'item-id', reason: 'It is vegetarian.' }],
        uncertainty: 'Availability can change.',
      }),
    );

    await expect(service.foodAssistant({
      prompt: 'Vegetarian lunch foo@example.test +1 555 123 4567',
      budgetMinor: 700,
    })).resolves.toMatchObject({
      suggestions: [{ id: 'item-id', priceMinor: 450, dietaryTags: ['vegetarian'] }],
    });
    expect(prisma.menuItem.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 150 }));
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'AI_FOOD_ASSISTANT_USED',
        after: { resultCount: 1 },
      }),
    }));
    expect(prisma.auditLog.create).toHaveBeenCalledOnce();
    expect(JSON.stringify(prisma.auditLog.create.mock.calls)).not.toContain('Vegetarian lunch');
    const providerRequest = JSON.parse(
      vi.mocked(fetch).mock.calls[0][1]?.body as string,
    ) as { messages: Array<{ content: string }> };
    expect(providerRequest.messages[1].content).toContain('[email removed]');
    expect(providerRequest.messages[1].content).toContain('[phone removed]');
    expect(providerRequest.messages[1].content).not.toContain('foo@example.test');
    expect(providerRequest.messages[1].content).not.toContain('555 123 4567');
  });

  it('rejects a meal plan whose computed total exceeds the supplied budget', async () => {
    vi.mocked(fetch).mockResolvedValue(
      providerResponse({
        summary: 'A bowl for two.',
        restaurantId: 'restaurant-id',
        items: [{ menuItemId: 'item-id', quantity: 2, reason: 'Shareable main.' }],
        uncertainty: 'Portions vary.',
      }),
    );

    await expect(
      service.mealPlan({ prompt: 'Lunch for two', people: 2, budgetMinor: 800 }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('requires structured budget and party size before planning a meal', async () => {
    await expect(service.mealPlan({ prompt: 'Lunch for two' })).rejects.toThrow(
      'A budget and number of people are required for a meal plan.',
    );
    expect(prisma.menuItem.findMany).not.toHaveBeenCalled();
  });

  it('returns a canonical voice-order proposal without placing or persisting an order', async () => {
    vi.mocked(fetch).mockResolvedValue(
      providerResponse({
        summary: 'One vegetable bowl from Local Kitchen.',
        restaurantId: 'restaurant-id',
        items: [{ menuItemId: 'item-id', quantity: 2, reason: 'A matching vegetarian main.' }],
        uncertainty: 'The restaurant may sell out.',
      }),
    );

    await expect(service.voiceOrder({ prompt: 'Order two vegetable bowls' })).resolves.toMatchObject({
      restaurantId: 'restaurant-id',
      items: [{ id: 'item-id', quantity: 2, priceMinor: 450 }],
      totalMinor: 900,
    });
    expect(prisma.menuItem.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'AI_VOICE_ORDER_PROPOSED', after: { resultCount: 1 } }),
    }));
  });

  it('analyzes only the signed-in customer cart and computes duplicate and value savings deterministically', async () => {
    const cartLine = (id: string) => ({
      id,
      menuItemId: 'item-id',
      quantity: id === 'line-one' ? 1 : 2,
      selections: [],
      menuItem: {
        id: 'item-id',
        name: 'Vegetable bowl',
        description: 'Rice and seasonal vegetables',
        priceMinor: 450,
        currency: 'INR',
        isAvailable: true,
        archivedAt: null,
        categoryId: 'mains-category',
        category: { name: 'Mains', isActive: true },
      },
    });
    prisma.cart.findFirst.mockResolvedValue({
      id: 'cart-id',
      restaurantId: 'restaurant-id',
      currency: 'INR',
      restaurant: {
        id: 'restaurant-id',
        name: 'Local Kitchen',
        city: 'Pune',
        offers: [{ id: 'offer-id', title: 'Lunch offer', description: 'Available today' }],
      },
      items: [cartLine('line-one'), cartLine('line-two')],
    });
    const cheaperAlternative = {
      id: 'cheaper-item', name: 'Seasonal rice bowl', priceMinor: 350, currency: 'INR', categoryId: 'mains-category',
    };
    const complementary = {
      id: 'complement-item', name: 'Lime soda', description: null, priceMinor: 100, currency: 'INR', dietaryTags: [],
      restaurant: candidate.restaurant,
    };
    prisma.menuItem.findMany
      .mockResolvedValueOnce([cheaperAlternative])
      .mockResolvedValueOnce([complementary]);
    vi.mocked(fetch).mockResolvedValue(providerResponse({
      summary: 'A drink pairs well with this meal.',
      suggestions: [{ menuItemId: 'complement-item', reason: 'A refreshing drink alongside the main.' }],
    }));

    await expect(service.smartCart('customer-id', 'cart-id')).resolves.toMatchObject({
      duplicates: [{ menuItemId: 'item-id', lineCount: 2, totalQuantity: 3 }],
      valueAlternatives: [{ replacement: { id: 'cheaper-item', priceMinor: 350 }, potentialSavingsMinor: 300 }],
      availableOffers: [{ id: 'offer-id' }],
      complementarySuggestions: [{ id: 'complement-item', priceMinor: 100 }],
      potentialSavingsMinor: 300,
    });
    expect(prisma.cart.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'cart-id', userId: 'customer-id' },
    }));
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actorUserId: 'customer-id', action: 'AI_SMART_CART_ANALYZED' }),
    }));
    expect(prisma.menuItem.create).not.toHaveBeenCalled();
  });

  it('keeps deterministic Smart Cart checks available when no AI provider is configured', async () => {
    config.get.mockReturnValue(undefined);
    prisma.cart.findFirst.mockResolvedValue({
      id: 'cart-id',
      restaurantId: 'restaurant-id',
      currency: 'INR',
      restaurant: {
        id: 'restaurant-id',
        name: 'Local Kitchen',
        city: 'Pune',
        offers: [],
      },
      items: [],
    });
    prisma.menuItem.findMany.mockResolvedValue([
      { ...candidate, id: 'complement-item' },
    ]);

    await expect(service.smartCart('customer-id', 'cart-id')).resolves.toMatchObject({
      complementarySuggestions: [],
      summary: expect.stringContaining('AI complementary suggestions are not configured'),
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('aggregates owner insights from paid-order snapshots and validates citations and metric keys', async () => {
    prisma.restaurant.findUnique.mockResolvedValue({ id: 'restaurant-id', name: 'Local Kitchen' });
    prisma.order.findMany.mockResolvedValue([
      {
        status: 'DELIVERED',
        subtotalMinor: 900,
        discountMinor: 100,
        createdAt: new Date('2026-10-08T10:00:00.000Z'),
        orderSnapshot: { items: [{ menuItemId: 'item-id', name: 'Vegetable bowl', quantity: 2, lineSubtotalMinor: 900 }] },
      },
      {
        status: 'CANCELLED_BY_CUSTOMER',
        subtotalMinor: 450,
        discountMinor: 0,
        createdAt: new Date('2026-10-08T11:00:00.000Z'),
        orderSnapshot: { items: [{ menuItemId: 'cancelled-item', name: 'Soup', quantity: 1, lineSubtotalMinor: 450 }] },
      },
    ]);
    prisma.orderReview.findMany.mockResolvedValue([
      { id: 'review-id', rating: 5, title: 'Great', body: 'The bowl was fresh.' },
    ]);
    prisma.orderReview.count.mockResolvedValue(4);
    vi.mocked(fetch).mockResolvedValue(providerResponse({
      summary: 'Sales were recorded and one order was cancelled.',
      sentimentThemes: [{ topic: 'Freshness', sentiment: 'positive', evidence: 'A published reviewer praised freshness.', reviewIds: ['review-id'] }],
      recommendations: [{ title: 'Review cancellation details', rationale: 'One customer cancellation occurred.', metricKeys: ['cancellation_patterns'] }],
    }));

    await expect(service.restaurantInsights('owner-id', 'restaurant-id', 30)).resolves.toMatchObject({
      metrics: {
        orderCount: 2,
        cancelledOrderCount: 1,
        netSalesMinor: 800,
        itemPerformance: [{ menuItemId: 'item-id', quantity: 2, salesMinor: 900 }],
        publishedReviewCount: 4,
      },
      sentimentThemes: [{ reviewIds: ['review-id'] }],
      recommendations: [{ metricKeys: ['cancellation_patterns'] }],
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actorUserId: 'owner-id', action: 'AI_RESTAURANT_INSIGHTS_GENERATED' }),
    }));
  });

  it('requires complete coordinates and uses the existing serviceability filter', async () => {
    await expect(service.foodAssistant({ prompt: 'Dinner nearby', latitude: 18.5 })).rejects.toThrow(
      'Latitude and longitude must be provided together.',
    );
    expect(restaurants.listPublic).not.toHaveBeenCalled();
    prisma.menuItem.findMany.mockResolvedValue([]);
    await service.foodAssistant({ prompt: 'Dinner nearby', latitude: 18.5, longitude: 73.8 });
    expect(restaurants.listPublic).toHaveBeenCalledWith({
      availability: 'open',
      latitude: 18.5,
      longitude: 73.8,
    });
  });

  it('rejects review citations that are not in the published source dataset', async () => {
    prisma.restaurant.findFirst.mockResolvedValue({ id: 'restaurant-id', name: 'Local Kitchen' });
    prisma.orderReview.findMany.mockResolvedValue([
      { id: 'published-review', rating: 5, title: 'Fresh', body: 'Very good food.' },
    ]);
    vi.mocked(fetch).mockResolvedValue(
      providerResponse({
        summary: 'Customers like it.',
        themes: [{ topic: 'Taste', sentiment: 'positive', evidence: 'Fresh food.', reviewIds: ['invented-review'] }],
        uncertainty: 'Only one review was available.',
      }),
    );

    await expect(service.reviewAnalysis('restaurant-id')).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('returns an unpublished partner menu draft without persisting it and audits the partner action', async () => {
    prisma.restaurant.findUnique.mockResolvedValue({
      id: 'restaurant-id',
      name: 'Local Kitchen',
      cuisineTypes: ['Indian'],
      categories: [{ name: 'Mains' }],
    });
    vi.mocked(fetch).mockResolvedValue(
      providerResponse({
        name: 'Garden rice bowl',
        description: 'Rice with seasonal vegetables.',
        categorySuggestion: 'Mains',
        searchKeywords: ['rice', 'vegetables'],
      }),
    );

    await expect(service.menuDraft('partner-id', 'restaurant-id', {
      itemInformation: 'Rice, seasonal vegetables, contact kitchen@example.test',
      claimedDietaryTags: ['vegetarian'],
    })).resolves.toMatchObject({
      draft: { name: 'Garden rice bowl', dietaryTags: ['vegetarian'], nutrition: null },
    });
    expect(prisma.menuItem.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        actorUserId: 'partner-id',
        action: 'AI_MENU_DRAFT_GENERATED',
        entityId: 'restaurant-id',
      }),
    }));
    const providerRequest = JSON.parse(
      vi.mocked(fetch).mock.calls[0][1]?.body as string,
    ) as { messages: Array<{ content: string }> };
    expect(providerRequest.messages[1].content).not.toContain('kitchen@example.test');
  });

  it('does not call a provider when server credentials are missing', async () => {
    config.get.mockReturnValue(undefined);
    await expect(service.foodAssistant({ prompt: 'Vegetarian lunch' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});