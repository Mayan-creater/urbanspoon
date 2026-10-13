import { expect, test } from '@playwright/test';
import type { Route } from '@playwright/test';

const runtimeEnvironment = globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
};
const appBaseUrl = `http://localhost:${runtimeEnvironment.process?.env?.PLAYWRIGHT_PORT ?? '3000'}`;

async function json(route: Route, data: unknown) {
  const origin = route.request().headers().origin;
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: origin
      ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' }
      : {},
    body: JSON.stringify({ data }),
  });
}

test('customer applies FoodCoins to the cart preview without stacking a coupon', async ({ page }) => {
  let previewInput: Record<string, unknown> | null = null;
  const cart = {
    id: 'cart-id',
    currency: 'INR',
    restaurant: { id: 'restaurant-id', name: 'Corner Kitchen', status: 'ACTIVE', isAcceptingOrders: true },
    items: [
      {
        id: 'cart-item-id',
        quantity: 1,
        menuItem: {
          id: 'menu-item-id',
          name: 'Rice Bowl',
          description: null,
          priceMinor: 2500,
          currency: 'INR',
          isAvailable: true,
          archivedAt: null,
          optionGroups: [],
        },
        selections: [],
      },
    ],
  };

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/carts' && request.method() === 'GET') return json(route, [cart]);
    if (path === '/api/v1/addresses' && request.method() === 'GET')
      return json(route, [
        {
          id: 'address-id',
          label: 'Home',
          line1: '12 Market Road',
          city: 'Pune',
          state: 'Maharashtra',
          postalCode: '411001',
          isDefault: true,
        },
      ]);
    if (path === '/api/v1/checkout/preview' && request.method() === 'POST') {
      previewInput = request.postDataJSON() as Record<string, unknown>;
      return json(route, {
        currency: 'INR',
        subtotalMinor: 2500,
        discountMinor: 100,
        feesMinor: 50,
        taxMinor: 123,
        tipMinor: 0,
        totalMinor: 2573,
        coupon: null,
        loyaltyRedemption: { points: 100, discountMinor: 100, ruleId: 'rule-id', ruleVersion: 2 },
        charges: [
          { type: 'ITEM_SUBTOTAL', amountMinor: 2500, ruleId: null, ruleVersion: null },
          { type: 'LOYALTY_REDEMPTION', amountMinor: -100, ruleId: null, ruleVersion: null },
        ],
      });
    }
    return json(route, {});
  });

  await page.goto(`${appBaseUrl}/cart`);
  await expect(page.getByRole('heading', { name: 'Cart and checkout preview' })).toBeVisible();
  await page.getByLabel('FoodCoins to redeem').fill('100');
  await expect(page.getByLabel('Coupon code')).toBeDisabled();
  await page.getByRole('button', { name: 'Recalculate total' }).click();
  await expect.poll(() => previewInput?.loyaltyPoints).toBe(100);
  await expect(page.getByText('100 FoodCoins')).toBeVisible();
  await expect(page.getByText('₹25.73')).toBeVisible();

  const viewportWidth = page.viewportSize()?.width ?? 1280;
  const renderedWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(renderedWidth).toBeLessThanOrEqual(viewportWidth);
});

test('customer places a local sandbox order from the cart', async ({ page }) => {
  const captured: {
    intentInput: Record<string, unknown> | null;
    confirmationInput: Record<string, unknown> | null;
  } = { intentInput: null, confirmationInput: null };
  let cartCleared = false;
  const cart = {
    id: 'cart-id',
    currency: 'INR',
    restaurant: { id: 'restaurant-id', name: 'Corner Kitchen', status: 'ACTIVE', isAcceptingOrders: true },
    items: [
      {
        id: 'cart-item-id',
        quantity: 1,
        menuItem: {
          id: 'menu-item-id',
          name: 'Rice Bowl',
          description: null,
          priceMinor: 2500,
          currency: 'INR',
          isAvailable: true,
          archivedAt: null,
          optionGroups: [],
        },
        selections: [],
      },
    ],
  };

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/carts' && request.method() === 'GET') return json(route, [cart]);
    if (path === '/api/v1/addresses' && request.method() === 'GET') return json(route, []);
    if (path === '/api/v1/checkout/preview' && request.method() === 'POST') {
      return json(route, {
        currency: 'INR',
        subtotalMinor: 2500,
        discountMinor: 0,
        feesMinor: 50,
        taxMinor: 123,
        tipMinor: 0,
        totalMinor: 2673,
        coupon: null,
        loyaltyRedemption: null,
        charges: [],
      });
    }
    if (path === '/api/v1/orders/intents' && request.method() === 'POST') {
      captured.intentInput = request.postDataJSON() as Record<string, unknown>;
      return json(route, {
        id: 'intent-id',
        status: 'OPEN',
        totalMinor: 2673,
        currency: 'INR',
        order: null,
      });
    }
    if (path === '/api/v1/orders/intents/intent-id/payment-attempts') return json(route, {});
    if (path === '/api/v1/orders/intents/intent-id/sandbox-payment') {
      captured.confirmationInput = request.postDataJSON() as Record<string, unknown>;
      return json(route, {
        intentStatus: 'CONFIRMED',
        order: { id: 'order-id', status: 'CONFIRMED', totalMinor: 2673, currency: 'INR' },
      });
    }
    if (path === '/api/v1/carts/cart-id' && request.method() === 'DELETE') {
      cartCleared = true;
      return json(route, { deleted: true });
    }
    return json(route, {});
  });

  await page.goto(`${appBaseUrl}/cart`);
  await page.getByRole('button', { name: 'Recalculate total' }).click();
  await page.getByRole('button', { name: 'Place test order' }).click();

  await expect(page.getByRole('heading', { name: 'Test order confirmed' })).toBeVisible();
  await expect(page.getByText('Order ID: order-id')).toBeVisible();
  await expect(page.getByText('No real payment was collected. This was a local sandbox order.')).toBeVisible();
  expect(captured.intentInput?.cartId).toBe('cart-id');
  expect(captured.confirmationInput?.outcome).toBe('SUCCEEDED');
  expect(cartCleared).toBe(true);
});

test('customer can see placed orders in their account', async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/me')
      return json(route, {
        id: 'customer-id',
        name: 'Sam Customer',
        email: 'sam@example.test',
        phone: null,
        roles: [{ role: 'customer', scopeType: 'GLOBAL', scopeId: null }],
      });
    if (path === '/api/v1/addresses') return json(route, []);
    if (path === '/api/v1/orders')
      return json(route, [
        {
          id: 'order-12345678-0000-4000-8000-000000000001',
          status: 'CONFIRMED',
          totalMinor: 2673,
          currency: 'INR',
          createdAt: '2026-10-13T10:00:00.000Z',
          restaurant: { name: 'Corner Kitchen' },
        },
      ]);
    return json(route, {});
  });

  await page.goto(`${appBaseUrl}/account`);

  await expect(page.getByRole('heading', { name: 'Your orders' })).toBeVisible();
  await expect(page.getByText('Corner Kitchen')).toBeVisible();
  await expect(page.getByText('Order order-12')).toBeVisible();
  await expect(page.getByText('confirmed')).toBeVisible();
});