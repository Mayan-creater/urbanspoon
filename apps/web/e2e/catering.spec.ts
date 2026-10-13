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

function localDateTime(date: Date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

test('customer submits and tracks an event catering request', async ({ page }) => {
  let requestBody: Record<string, unknown> | null = null;
  let submitted = false;
  const request = {
    id: 'event-request-id',
    status: 'OPEN',
    guestCount: 20,
    budgetMinor: 50000,
    currency: 'INR',
    cuisineTypes: ['Indian'],
    dietaryTags: ['vegetarian'],
    occasion: 'Team lunch',
    eventAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    city: 'Pune',
    state: 'MH',
    postalCode: '411001',
    venueAddress: '12 Market Street',
    details: null,
    quotes: [],
  };
  await page.route(`${apiBase}/catering/requests`, async (route) => {
    if (route.request().method() === 'POST') {
      requestBody = route.request().postDataJSON() as Record<string, unknown>;
      submitted = true;
      return json(route, request);
    }
    return json(route, submitted ? [request] : []);
  });

  await page.goto('/events');
  await page.getByLabel('Occasion').fill('Team lunch');
  await page.getByLabel('Event date and time').fill(localDateTime(new Date(Date.now() + 7 * 86_400_000)));
  await page.getByLabel('Guests').fill('20');
  await page.getByLabel('Budget (₹)').fill('500');
  await page.getByLabel('Cuisine preferences').fill('Indian');
  await page.getByLabel('Dietary requirements').fill('vegetarian');
  await page.getByLabel('City').fill('Pune');
  await page.getByLabel('State').fill('MH');
  await page.getByLabel('Postal code').fill('411001');
  await page.getByLabel('Venue address').fill('12 Market Street');
  await page.getByRole('button', { name: 'Request quotations' }).click();

  await expect(page.getByRole('heading', { name: 'Team lunch' })).toBeVisible();
  await expect(page.getByText('Request sent to matching opted-in caterers.')).toBeVisible();
  expect(requestBody).toMatchObject({
    guestCount: 20,
    budgetMinor: 50000,
    cuisineTypes: ['Indian'],
    dietaryTags: ['vegetarian'],
    city: 'Pune',
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()?.width ?? 1280);
});

test('opted-in restaurant submits a revisioned catering quotation', async ({ page }) => {
  let quoteBody: Record<string, unknown> | null = null;
  let cateringEnabled = false;
  const restaurant = {
    id: 'green-fork-id',
    name: 'Green Fork Cafe',
    city: 'Pune',
    status: 'ACTIVE',
    supportsCatering: false,
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
  const eventRequest = {
    id: 'event-request-id',
    guestCount: 20,
    budgetMinor: 50000,
    currency: 'INR',
    cuisineTypes: ['Indian'],
    dietaryTags: ['vegetarian'],
    occasion: 'Team lunch',
    eventAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    city: 'Pune',
    state: 'MH',
    postalCode: '411001',
    venueAddress: '12 Market Street',
    details: null,
    quotes: [],
  };
  await page.route(`${apiBase}/partner/restaurants`, async (route) => json(route, [{ ...restaurant, supportsCatering: cateringEnabled }]));
  await page.route(`${apiBase}/partner/restaurants/green-fork-id/menu`, async (route) => json(route, []));
  await page.route(`${apiBase}/partner/restaurants/green-fork-id/offers`, async (route) => json(route, []));
  await page.route(`${apiBase}/partner/restaurants/green-fork-id/catering`, async (route) => {
    cateringEnabled = (route.request().postDataJSON() as { enabled: boolean }).enabled;
    return json(route, { id: 'green-fork-id', supportsCatering: cateringEnabled });
  });
  await page.route(`${apiBase}/partner/restaurants/green-fork-id/catering/requests`, async (route) => json(route, cateringEnabled ? [eventRequest] : []));
  await page.route(`${apiBase}/partner/restaurants/green-fork-id/catering/requests/event-request-id/quotes`, async (route) => {
    quoteBody = route.request().postDataJSON() as Record<string, unknown>;
    return json(route, { id: 'quote-id', revision: 1, status: 'SUBMITTED' });
  });

  await page.goto('/partner');
  const cateringToggle = page.getByRole('checkbox', { name: 'Receive local event requests' });
  await expect(cateringToggle).not.toBeChecked();
  await cateringToggle.click();
  await expect(cateringToggle).toBeChecked();
  await expect(page.getByRole('heading', { name: 'Team lunch' })).toBeVisible();
  await page.getByLabel('Price before tax (INR)').fill('450');
  await page.getByLabel('Tax (INR)', { exact: true }).fill('22');
  await page.getByLabel('Valid until').fill(localDateTime(new Date(Date.now() + 7 * 86_400_000)));
  await page.getByLabel('Inclusions').fill('Buffet meal, serving staff');
  await page.getByLabel('Quote notes').fill('Setup included.');
  await page.getByRole('button', { name: 'Submit quotation' }).click();

  await expect(page.getByText('Quotation submitted. The customer can review this revision.')).toBeVisible();
  expect(quoteBody).toMatchObject({
    amountMinor: 45000,
    taxMinor: 2200,
    currency: 'INR',
    inclusions: ['Buffet meal', 'serving staff'],
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()?.width ?? 1280);
});