import { expect, test } from '@playwright/test';
import type { Route } from '@playwright/test';

const inviteToken = 'g'.repeat(43);

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

function groupData(status: 'OPEN' | 'LOCKED' | 'CHECKED_OUT', items: Array<Record<string, unknown>>) {
  return {
    id: 'group-order-id',
    cartId: 'cart-id',
    hostUserId: 'host-id',
    currentUserId: 'host-id',
    isHost: true,
    status,
    deadlineAt: null,
    host: { id: 'host-id', name: 'Host Customer' },
    members: [
      { user: { id: 'host-id', name: 'Host Customer' }, joinedAt: '2026-10-09T10:00:00.000Z' },
      { user: { id: 'guest-id', name: 'Guest Customer' }, joinedAt: '2026-10-09T10:05:00.000Z' },
    ],
    cart: {
      restaurant: { id: 'restaurant-id', name: 'Corner Kitchen' },
      items,
    },
  };
}

test('host creates, shares, locks, and checks out a group order with participant items', async ({
  page,
}) => {
  let groupStatus: 'OPEN' | 'LOCKED' | 'CHECKED_OUT' = 'OPEN';
  const sharedItems: Array<Record<string, unknown>> = [];
  let addedItem: Record<string, unknown> | null = null;

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/api/v1/carts' && request.method() === 'GET') {
      return json(route, [
        {
          id: 'cart-id',
          restaurantId: 'restaurant-id',
          currency: 'INR',
          restaurant: { id: 'restaurant-id', name: 'Corner Kitchen' },
          items: [],
        },
      ]);
    }
    if (path === '/api/v1/group-orders' && request.method() === 'POST') {
      return json(route, groupData(groupStatus, sharedItems));
    }
    if (path === '/api/v1/group-orders/group-order-id/invites') {
      return json(route, { id: 'invite-id', token: inviteToken, expiresAt: '2026-10-10T10:00:00.000Z' });
    }
    if (path === '/api/v1/group-orders/group-order-id' && request.method() === 'GET') {
      return json(route, groupData(groupStatus, sharedItems));
    }
    if (path === '/api/v1/group-orders/group-order-id/items' && request.method() === 'POST') {
      addedItem = request.postDataJSON() as Record<string, unknown>;
      sharedItems.push({
        id: 'group-item-id',
        quantity: Number(addedItem.quantity),
        menuItem: { id: 'bowl-id', name: 'Rice Bowl', priceMinor: 1200, currency: 'INR' },
        addedBy: { id: 'host-id', name: 'Host Customer' },
      });
      return json(route, { itemId: 'group-item-id', addedByUserId: 'host-id' });
    }
    if (path === '/api/v1/group-orders/group-order-id/items/group-item-id' && request.method() === 'PATCH') {
      const payload = request.postDataJSON() as { quantity: number };
      sharedItems[0].quantity = payload.quantity;
      return json(route, { id: 'group-item-id', quantity: payload.quantity });
    }
    if (path === '/api/v1/group-orders/group-order-id/lock') {
      groupStatus = 'LOCKED';
      return json(route, { id: 'group-order-id', status: groupStatus, cartId: 'cart-id' });
    }
    if (path === '/api/v1/group-orders/group-order-id/checkout') {
      groupStatus = 'CHECKED_OUT';
      return json(route, { id: 'intent-id', status: 'OPEN' });
    }
    if (path === '/api/v1/restaurants/restaurant-id/menu') {
      return json(route, {
        id: 'restaurant-id',
        name: 'Corner Kitchen',
        description: 'Neighborhood meals',
        city: 'Pune',
        state: 'Maharashtra',
        isAcceptingOrders: true,
        categories: [
          {
            id: 'category-id',
            name: 'Bowls',
            description: null,
            items: [
              {
                id: 'bowl-id',
                name: 'Rice Bowl',
                description: null,
                priceMinor: 1200,
                currency: 'INR',
                dietaryTags: [],
                optionGroups: [],
              },
            ],
          },
        ],
        items: [],
      });
    }
    if (path === '/api/v1/restaurants/restaurant-id/reviews') return json(route, []);
    return json(route, {});
  });

  await page.goto('/group-orders');
  await page.getByRole('button', { name: 'Create group order' }).click();
  await expect(page.getByRole('heading', { name: 'OPEN' })).toBeVisible();
  await expect(page.getByLabel('Single-use invite link')).toHaveValue(
    new RegExp(`/group-orders\\?token=${inviteToken}`),
  );

  await page.getByRole('link', { name: 'Browse Corner Kitchen menu' }).click();
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByRole('status')).toContainText('shared group order');
  expect(addedItem).toMatchObject({ menuItemId: 'bowl-id', quantity: 1 });

  await page.getByRole('link', { name: 'Back to group order' }).click();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText('Added by Host Customer')).toBeVisible();
  await page.getByLabel('Quantity').fill('3');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Shared item quantity updated.')).toBeVisible();
  await page.getByRole('button', { name: 'Lock group' }).click();
  await expect(page.getByRole('heading', { name: 'LOCKED' })).toBeVisible();
  await page.getByRole('button', { name: 'Start checkout' }).click();
  await expect(page.getByText('Checkout intent: intent-id')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'CHECKED OUT' })).toBeVisible();

  const viewportWidth = page.viewportSize()?.width ?? 1280;
  const renderedWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(renderedWidth).toBeLessThanOrEqual(viewportWidth);
});

test('participant joins once with a single-use invite and sees host controls withheld', async ({
  page,
}) => {
  let joined = false;
  await page.route('**/api/v1/carts', async (route) => json(route, []));
  await page.route('**/api/v1/group-orders/join', async (route) => {
    joined = true;
    return json(route, {
      ...groupData('OPEN', []),
      currentUserId: 'guest-id',
      isHost: false,
      members: [
        { user: { id: 'host-id', name: 'Host Customer' }, joinedAt: '2026-10-09T10:00:00.000Z' },
        { user: { id: 'guest-id', name: 'Guest Customer' }, joinedAt: '2026-10-09T10:05:00.000Z' },
      ],
    });
  });

  await page.goto(`/group-orders?token=${inviteToken}`);
  await page.getByRole('button', { name: 'Join group' }).click();
  await expect.poll(() => joined).toBe(true);
  await expect(page.getByText('You joined the group order.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lock group' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start checkout' })).toHaveCount(0);
});