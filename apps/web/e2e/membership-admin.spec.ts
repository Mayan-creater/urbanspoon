import { expect, test } from '@playwright/test';

const appBaseUrl = `http://localhost:${process.env.PLAYWRIGHT_PORT ?? '3000'}`;

test('admin creates and disables an effective-dated FoodPass plan version', async ({ page }) => {
  const startsAt = new Date(Date.now() + 86_400_000);
  const endsAt = new Date(Date.now() + 365 * 86_400_000);
  let plans: Array<Record<string, unknown>> = [];
  let createdPayload: Record<string, unknown> | null = null;

  await page.route('**/api/v1/admin/memberships/plans**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    if (request.method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: plans }),
      });
    }
    if (path.endsWith('/foodpass-v1/disable')) {
      plans = plans.map((plan) => ({ ...plan, isActive: false }));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: plans[0] }),
      });
    }
    if (request.method() === 'POST') {
      createdPayload = request.postDataJSON() as Record<string, unknown>;
      plans = [
        {
          id: 'foodpass-v1',
          key: 'foodpass-plus',
          name: String(createdPayload.name),
          description: String(createdPayload.description),
          priceMinor: Number(createdPayload.priceMinor),
          currency: String(createdPayload.currency),
          interval: String(createdPayload.interval),
          benefits: createdPayload.benefits as string[],
          version: 1,
          isActive: true,
          effectiveFrom: String(createdPayload.effectiveFrom),
          effectiveUntil: null,
        },
      ];
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: plans[0] }),
      });
    }
    return route.continue();
  });

  await page.goto(`${appBaseUrl}/admin/memberships`);
  await expect(page.getByRole('heading', { name: 'FoodPass plans' })).toBeVisible();
  await page.getByLabel('Plan key').fill('foodpass-plus');
  await page.getByLabel('Plan name').fill('FoodPass Plus');
  await page.getByLabel('Description').fill('Monthly neighborhood dining benefits');
  await page.getByLabel('Price (minor units)').fill('49900');
  await page.getByLabel('Currency').fill('INR');
  await page.getByLabel('Billing interval').selectOption('MONTHLY');
  await page.getByLabel('Benefits (comma-separated)').fill('Free delivery, Member-only offers');
  await page.getByLabel('Effective from').fill(startsAt.toISOString().slice(0, 16));
  await page.getByLabel('Effective until (optional)').fill(endsAt.toISOString().slice(0, 16));
  await page.getByRole('button', { name: 'Create plan version' }).click();

  await expect.poll(() => createdPayload?.benefits).toEqual(['Free delivery', 'Member-only offers']);
  await expect(page.getByText('FoodPass Plus v1')).toBeVisible();
  await expect(page.getByText('Activation remains payment-gated.')).toBeVisible();
  await page.getByRole('button', { name: 'Disable' }).click();
  await expect(page.getByRole('row').getByText('DISABLED', { exact: true })).toBeVisible();

  const viewportWidth = page.viewportSize()?.width ?? 1280;
  const renderedWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(renderedWidth).toBeLessThanOrEqual(viewportWidth);
});