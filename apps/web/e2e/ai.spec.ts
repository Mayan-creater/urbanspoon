import { expect, test } from '@playwright/test';
import type { Route } from '@playwright/test';

const apiBase = 'http://localhost:3001/api/v1';

async function json(route: Route, data: unknown) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data }),
  });
}

const suggestion = {
  id: 'vegetable-bowl-id',
  name: 'Vegetable bowl',
  priceMinor: 450,
  currency: 'INR',
  restaurant: { id: 'green-fork-id', name: 'Green Fork Cafe', city: 'Pune' },
  reason: 'It matches the vegetarian preference.',
};

test('customer asks the food assistant and reviews a bounded meal plan', async ({ page }) => {
  let mealPlanRequest: Record<string, unknown> | null = null;
  await page.route(`${apiBase}/restaurants`, async (route) =>
    json(route, [{ id: 'green-fork-id', name: 'Green Fork Cafe', city: 'Pune' }]),
  );
  await page.route(`${apiBase}/ai/food-assistant`, async (route) =>
    json(route, {
      answer: 'A vegetarian bowl is available at Green Fork Cafe.',
      suggestions: [suggestion],
      uncertainty: 'Availability can change.',
    }),
  );
  await page.route(`${apiBase}/ai/meal-plans`, async (route) => {
    mealPlanRequest = route.request().postDataJSON() as Record<string, unknown>;
    return json(route, {
      summary: 'A simple meal for two.',
      restaurantId: 'green-fork-id',
      items: [{ ...suggestion, quantity: 2 }],
      totalMinor: 900,
      uncertainty: 'Portions vary.',
    });
  });
  await page.route(`${apiBase}/ai/voice-order`, async (route) =>
    json(route, {
      summary: 'One vegetable bowl from Green Fork Cafe.',
      restaurantId: 'green-fork-id',
      items: [{ ...suggestion, quantity: 1 }],
      totalMinor: 450,
      uncertainty: 'Availability can change.',
    }),
  );

  await page.goto('/ai');
  await page.getByRole('textbox', { name: 'What sounds good?' }).fill('Vegetarian lunch');
  await page.getByRole('button', { name: 'Ask the assistant' }).click();
  await expect(page.getByRole('heading', { name: 'A vegetarian bowl is available at Green Fork Cafe.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View menu' })).toHaveAttribute('href', '/restaurants/green-fork-id');
  await expect(page.getByText('₹4.50')).toBeVisible();

  await page.getByRole('button', { name: 'Plan a meal' }).click();
  const budget = page.getByRole('spinbutton', { name: 'Budget (₹)' });
  const people = page.getByRole('spinbutton', { name: 'People' });
  await expect(budget).toHaveAttribute('required', '');
  await expect(people).toHaveAttribute('required', '');
  await budget.fill('20');
  await people.fill('2');
  await page.getByRole('textbox', { name: 'What sounds good?' }).fill('Vegetarian lunch for two');
  await page.getByRole('button', { name: 'Build meal plan' }).click();
  await expect(page.getByRole('heading', { name: 'A simple meal for two.' })).toBeVisible();
  await expect(page.getByText('Proposed total')).toBeVisible();
  expect(mealPlanRequest).toMatchObject({ prompt: 'Vegetarian lunch for two', budgetMinor: 2000, people: 2 });

  await page.getByRole('button', { name: 'Voice order' }).click();
  await page.getByRole('textbox', { name: 'What sounds good?' }).fill('Order a vegetable bowl');
  await page.getByRole('button', { name: 'Propose this order' }).click();
  await expect(page.getByText('Proposed voice order')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'One vegetable bowl from Green Fork Cafe.' })).toBeVisible();
  await expect(page.getByText(/Voice orders are proposals only/)).toBeVisible();

  const viewportWidth = page.viewportSize()?.width ?? 1280;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewportWidth);
});

test('customer reviews Smart Cart and confirms an addition before the cart changes', async ({ page }) => {
  let addRequests = 0;
  const cart = {
    id: 'cart-id',
    currency: 'INR',
    restaurant: { id: 'green-fork-id', name: 'Green Fork Cafe', status: 'ACTIVE', isAcceptingOrders: true },
    items: [{
      id: 'cart-line-id',
      quantity: 1,
      menuItem: {
        id: 'vegetable-bowl-id',
        name: 'Vegetable bowl',
        description: null,
        priceMinor: 450,
        currency: 'INR',
        isAvailable: true,
        archivedAt: null,
        optionGroups: [],
      },
      selections: [],
    }],
  };
  await page.route(`${apiBase}/carts`, async (route) => json(route, [cart]));
  await page.route(`${apiBase}/addresses`, async (route) => json(route, []));
  await page.route(`${apiBase}/ai/smart-cart`, async (route) => json(route, {
    cartId: 'cart-id',
    restaurant: { id: 'green-fork-id', name: 'Green Fork Cafe', city: 'Pune' },
    currency: 'INR',
    duplicates: [{ menuItemId: 'vegetable-bowl-id', name: 'Vegetable bowl', lineCount: 2, totalQuantity: 3 }],
    valueAlternatives: [],
    availableOffers: [],
    complementarySuggestions: [{ ...suggestion, id: 'complement-id', name: 'Lime soda', reason: 'Pairs well with the bowl.' }],
    potentialSavingsMinor: 0,
    savingsNote: 'No price changes are applied.',
    summary: 'Review the cart before deciding.',
    uncertainty: 'Availability may change.',
  }));
  await page.route(`${apiBase}/carts/cart-id/items`, async (route) => {
    addRequests += 1;
    expect(route.request().postDataJSON()).toEqual({ menuItemId: 'complement-id', quantity: 1 });
    return json(route, cart);
  });

  await page.goto('/cart');
  await page.getByRole('button', { name: 'Review cart' }).click();
  await expect(page.getByRole('heading', { name: 'Duplicate lines' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Suggested additions' })).toBeVisible();
  expect(addRequests).toBe(0);
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByRole('status')).toContainText('Item added to your cart');
  expect(addRequests).toBe(1);

  const viewportWidth = page.viewportSize()?.width ?? 1280;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewportWidth);
});

test('restaurant partner requests insights for a selected period', async ({ page }) => {
  let requestedDays = 0;
  const restaurant = {
    id: 'green-fork-id',
    name: 'Green Fork Cafe',
    city: 'Pune',
    status: 'ACTIVE',
    isAcceptingOrders: true,
    description: null,
    phone: null,
    email: null,
    addressLine1: '1 Main Road',
    state: 'MH',
    postalCode: '411001',
    cuisineTypes: ['Indian'],
    latitude: null,
    longitude: null,
    serviceRadiusKm: 10,
    estimatedEtaMinMinutes: 25,
    estimatedEtaMaxMinutes: 40,
    hours: [],
  };
  await page.route(`${apiBase}/partner/restaurants`, async (route) => json(route, [restaurant]));
  await page.route(`${apiBase}/partner/restaurants/green-fork-id/menu`, async (route) => json(route, []));
  await page.route(`${apiBase}/partner/restaurants/green-fork-id/offers`, async (route) => json(route, []));
  await page.route(`${apiBase}/ai/partner/restaurants/green-fork-id/insights`, async (route) => {
    requestedDays = (route.request().postDataJSON() as { days: number }).days;
    return json(route, {
      restaurant,
      metrics: {
        days: requestedDays,
        orderCount: 12,
        cancelledOrderCount: 2,
        netSalesMinor: 84000,
        salesTrend: [{ date: '2026-10-08', orderCount: 3, netSalesMinor: 21000, cancellations: 1 }],
        itemPerformance: [{ menuItemId: 'bowl-id', name: 'Vegetable bowl', quantity: 8, salesMinor: 36000 }],
        cancellationPatterns: [{ status: 'CANCELLED_BY_CUSTOMER', count: 2 }],
        publishedReviewCount: 4,
        averageRating: 4.5,
      },
      sentimentThemes: [{ topic: 'Freshness', sentiment: 'positive', evidence: 'Reviewers mention fresh vegetables.', reviewIds: ['review-id'] }],
      recommendations: [{ title: 'Review late-day cancellations', rationale: 'Cancellations cluster near closing.', metricKeys: ['cancellation_patterns'] }],
      summary: 'Recorded sales are steady; review closing-time cancellations.',
    });
  });

  await page.goto('/partner');
  await page.getByLabel('Period').selectOption('7');
  await page.getByRole('button', { name: 'Generate insights' }).click();
  await expect(page.getByText('Recorded sales are steady; review closing-time cancellations.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Item performance' })).toBeVisible();
  await expect(page.getByText('Vegetable bowl')).toBeVisible();
  expect(requestedDays).toBe(7);

  const viewportWidth = page.viewportSize()?.width ?? 1280;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewportWidth);
});