import { expect, test } from '@playwright/test';

const appBaseUrl = `http://localhost:${process.env.PLAYWRIGHT_PORT ?? '3000'}`;

test('customer views FoodCoins balance and earning history', async ({ page }) => {
  let walletRequests = 0;
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.replace(/\/+$/, '') !== '/api/v1/loyalty') return route.continue();
    walletRequests += 1;
    const origin = route.request().headers().origin;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: origin
        ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' }
        : {},
      body: JSON.stringify({
        data: {
          balancePoints: 1250,
          lifetimeEarnedPoints: 1250,
          tier: { name: 'SILVER', threshold: 500, multiplierBps: 11000 },
          transactions: [
            {
              id: 'earning-id',
              type: 'EARN',
              points: 250,
              createdAt: '2026-10-09T10:00:00.000Z',
              order: { id: 'order-12345678' },
              rule: { currency: 'INR', version: 2 },
            },
          ],
        },
      }),
    });
  });

  await page.goto(`${appBaseUrl}/loyalty`);
  await expect(page.getByRole('heading', { name: 'FoodCoins' })).toBeVisible();
  await expect.poll(() => walletRequests).toBeGreaterThan(0);
  await expect(
    page.getByRole('region', { name: 'FoodCoins balance' }).getByText('1,250 coins'),
  ).toBeVisible();
  await expect(page.getByText('+250', { exact: false })).toBeVisible();
  await expect(page.getByText('Order order-12 · Rule v2')).toBeVisible();

  const viewportWidth = page.viewportSize()?.width ?? 1280;
  const renderedWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(renderedWidth).toBeLessThanOrEqual(viewportWidth);
});

test('prompts unauthenticated customers to sign in', async ({ page }) => {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.replace(/\/+$/, '') !== '/api/v1/loyalty') return route.continue();
    const origin = route.request().headers().origin;
    return route.fulfill({
      status: 401,
      headers: origin
        ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' }
        : {},
    });
  });

  await page.goto(`${appBaseUrl}/loyalty`);
  await expect(page.getByRole('heading', { name: 'Sign in to view your balance' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
});