import { expect, test } from '@playwright/test';
import type { Route } from '@playwright/test';

const appBaseUrl = `http://localhost:${process.env.PLAYWRIGHT_PORT ?? '3000'}`;

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

test('admin versions, scopes, and disables a first-order campaign', async ({ page }) => {
  const startsAt = new Date(Date.now() + 86_400_000);
  const endsAt = new Date(Date.now() + 14 * 86_400_000);
  let campaigns = [
    {
      id: 'campaign-v1',
      campaignKey: 'demo-welcome',
      campaignName: 'Demo welcome offer',
      version: 1,
      code: 'DEMO10',
      discountType: 'PERCENTAGE',
      discountValue: 1000,
      currency: 'INR',
      minSubtotalMinor: 20_000,
      maxDiscountMinor: 5_000,
      usageLimit: 100,
      usageCount: 4,
      perUserLimit: 1,
      firstOrderOnly: true,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      isActive: true,
      restaurant: null,
    },
  ];
  let createdPayload: Record<string, unknown> | null = null;

  await page.route('**/api/v1/admin/coupons**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    if (request.method() === 'GET') return json(route, campaigns);
    if (path.endsWith('/campaign-v2/disable')) {
      campaigns = campaigns.map((campaign) =>
        campaign.id === 'campaign-v2' ? { ...campaign, isActive: false } : campaign,
      );
      return json(route, campaigns[1]);
    }
    if (request.method() === 'POST') {
      createdPayload = request.postDataJSON() as Record<string, unknown>;
      campaigns = [
        { ...campaigns[0], isActive: false, endsAt: String(createdPayload.startsAt) },
        {
          ...campaigns[0],
          id: 'campaign-v2',
          campaignName: String(createdPayload.campaignName),
          version: 2,
          code: String(createdPayload.code),
          discountValue: Number(createdPayload.discountValue),
          usageCount: 0,
          perUserLimit: Number(createdPayload.perUserLimit),
          firstOrderOnly: Boolean(createdPayload.firstOrderOnly),
          startsAt: String(createdPayload.startsAt),
          endsAt: String(createdPayload.endsAt),
          isActive: true,
        },
      ];
      return json(route, campaigns[1]);
    }
    return route.continue();
  });

  await page.goto(`${appBaseUrl}/admin/promotions`);
  await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible();
  await expect(page.getByText('Demo welcome offer v1')).toBeVisible();

  await page.getByLabel('Campaign key').fill('demo-welcome');
  await page.getByLabel('Campaign name').fill('Demo welcome refresh');
  await page.getByLabel('Coupon code').fill('WELCOME15');
  await page.getByLabel('Discount type').selectOption('PERCENTAGE');
  await page.getByLabel('Discount value').fill('1500');
  await page.getByLabel('Currency').fill('INR');
  await page.getByLabel('Minimum item subtotal (minor units)').fill('20000');
  await page.getByLabel('Uses per customer').fill('1');
  await page.getByLabel('Starts at').fill(startsAt.toISOString().slice(0, 16));
  await page.getByLabel('Ends at').fill(endsAt.toISOString().slice(0, 16));
  await page.getByLabel('First order only').check();
  await page.getByRole('button', { name: 'Create version' }).click();

  await expect.poll(() => createdPayload?.campaignKey).toBe('demo-welcome');
  await expect(page.getByText('Demo welcome refresh v2')).toBeVisible();
  await expect(page.getByText('Campaign version created. Coupon and FoodCoins cannot stack.')).toBeVisible();

  const campaignRow = page.getByRole('row').filter({ hasText: 'WELCOME15' });
  await campaignRow.getByRole('button', { name: 'Disable' }).click();
  await expect(campaignRow.getByText('DISABLED', { exact: true })).toBeVisible();

  const viewportWidth = page.viewportSize()?.width ?? 1280;
  const renderedWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(renderedWidth).toBeLessThanOrEqual(viewportWidth);
});