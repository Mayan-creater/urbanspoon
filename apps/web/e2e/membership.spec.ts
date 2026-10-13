import { expect, test } from '@playwright/test';

const appBaseUrl = `http://localhost:${process.env.PLAYWRIGHT_PORT ?? '3000'}`;

test('customer browses configured FoodPass plans without premature activation', async ({ page }) => {
  await page.route('**/api/v1/memberships/plans', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            id: 'foodpass-monthly-v1',
            key: 'foodpass-plus',
            name: 'FoodPass Plus',
            description: 'A monthly dining plan.',
            priceMinor: 49900,
            currency: 'INR',
            interval: 'MONTHLY',
            benefits: ['Free delivery', 'Member-only offers'],
            version: 1,
          },
        ],
      }),
    }),
  );
  await page.route('**/api/v1/memberships/me', async (route) =>
    route.fulfill({ status: 401 }),
  );

  await page.goto(`${appBaseUrl}/membership`);
  await expect(page.getByRole('heading', { name: 'Membership plans' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'FoodPass Plus' })).toBeVisible();
  await expect(page.getByText('₹499.00')).toBeVisible();
  await expect(page.getByText('Free delivery')).toBeVisible();
  await expect(page.getByText('Plan activation is unavailable until a payment provider is configured.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');

  const viewportWidth = page.viewportSize()?.width ?? 1280;
  const renderedWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(renderedWidth).toBeLessThanOrEqual(viewportWidth);
});