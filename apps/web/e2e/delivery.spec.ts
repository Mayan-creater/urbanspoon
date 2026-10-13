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

test('admin can review a partner and reconcile an approved sandbox payout', async ({ page }) => {
  let partnerPending = true;
  let payoutStatus: 'REQUESTED' | 'APPROVED' | 'PAID' = 'REQUESTED';
  const partner = {
    id: 'partner-id',
    vehicleType: 'SCOOTER',
    marketRegion: 'IN',
    verificationStatus: 'PENDING',
    createdAt: '2026-10-01T10:00:00.000Z',
    user: { name: 'Test Courier', email: 'courier@example.test', phone: null },
  };
  const partnerDocuments = [
    {
      id: 'identity-evidence-id',
      evidenceType: 'IDENTITY',
      originalFilename: 'identity-card.pdf',
      sizeBytes: 64,
      deliveryId: null,
      createdAt: '2026-10-01T10:05:00.000Z',
    },
    {
      id: 'vehicle-evidence-id',
      evidenceType: 'VEHICLE',
      originalFilename: 'vehicle-registration.pdf',
      sizeBytes: 64,
      deliveryId: null,
      createdAt: '2026-10-01T10:05:00.000Z',
    },
  ];
  const payout = {
    id: 'payout-id',
    amountMinor: 1250,
    currency: 'INR',
    provider: 'RAZORPAY_ROUTE',
    status: 'REQUESTED',
    periodStart: '2026-09-01T00:00:00.000Z',
    periodEnd: '2026-09-30T23:59:59.000Z',
    requestedAt: '2026-10-01T10:00:00.000Z',
    deliveryPartner: { user: { name: 'Test Courier', email: 'courier@example.test' } },
    earnings: [{ id: 'earning-id', amountMinor: 1250, earningType: 'BASE' }],
  };

  await page.route(`${apiBase}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'POST' && url.pathname.endsWith('/review')) {
      partnerPending = false;
      return json(route, { verificationStatus: 'VERIFIED' });
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/approve')) {
      payoutStatus = 'APPROVED';
      return json(route, { ...payout, status: payoutStatus });
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/sandbox-transfer')) {
      payoutStatus = 'PAID';
      return json(route, {
        ...payout,
        status: payoutStatus,
        providerReference: 'sandbox-payout-id',
        transferMode: 'SANDBOX_NO_FUNDS_MOVED',
      });
    }
    if (request.method() === 'GET' && url.pathname.endsWith('/content')) {
      return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-test' });
    }
    if (url.pathname === '/api/v1/admin/delivery-partners') {
      return json(route, partnerPending ? [partner] : []);
    }
    if (url.pathname === '/api/v1/admin/delivery-partners/partner-id/evidence') {
      return json(route, partnerDocuments);
    }
    if (url.pathname === '/api/v1/admin/partner-payouts') {
      return json(
        route,
        url.searchParams.get('status') === payoutStatus
          ? [{ ...payout, status: payoutStatus }]
          : [],
      );
    }
    if (url.pathname === '/api/v1/admin/deliveries/evidence') return json(route, []);
    return json(route, {});
  });

  await page.goto('/admin/delivery');
  await expect(page.getByRole('heading', { name: 'Delivery review' })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Pending verification' }).getByRole('heading', {
      name: 'Test Courier',
    }),
  ).toBeVisible();
  const evidenceDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: /identity.*identity-card\.pdf/ }).click();
  expect((await evidenceDownload).suggestedFilename()).toBe('identity-card.pdf');
  await page.getByRole('button', { name: 'Approve partner' }).click();
  await expect(page.getByText('No pending partner reviews.')).toBeVisible();
  await page.getByRole('button', { name: 'Approve payout' }).click();
  await page.getByRole('button', { name: 'Simulate sandbox transfer' }).click();
  await expect(
    page.getByText('Sandbox payout completed for workflow testing; no funds were moved.'),
  ).toBeVisible();
  await expect(page.getByText('No open payout requests.')).toBeVisible();
});

test('courier uploads delivery proof and completes the drop-off with a reported cash tip', async ({
  page,
}) => {
  let availability = 'BUSY';
  let active = {
    id: 'delivery-id',
    status: 'ARRIVED',
    estimatedPreparationMinutes: 20,
    estimatedReadyAt: null,
    order: {
      id: 'order-id',
      status: 'PICKED_UP',
      currency: 'INR',
      totalMinor: 2500,
      restaurant: { name: 'Test Kitchen', addressLine1: '1 Food Street', city: 'Pune' },
      orderSnapshot: {
        address: { line1: '2 Customer Road', city: 'Pune', state: 'MH', postalCode: '411001' },
        items: [],
      },
    },
    statusHistory: [],
  };
  let uploadedEvidence: Array<Record<string, unknown>> = [];
  let completionPayload: Record<string, unknown> | undefined;

  await page.route(`${apiBase}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/events')) {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/evidence')) {
      uploadedEvidence = [
        {
          id: 'proof-id',
          evidenceType: 'DELIVERY_PROOF',
          originalFilename: 'dropoff.png',
          sizeBytes: 8,
          deliveryId: 'delivery-id',
          createdAt: new Date().toISOString(),
        },
      ];
      return json(route, uploadedEvidence[0]);
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/active/complete')) {
      completionPayload = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
      active = null as never;
      availability = 'ONLINE';
      return json(route, { status: 'DELIVERED' });
    }
    if (url.pathname === '/api/v1/delivery/profile') {
      return json(route, {
        id: 'partner-id',
        vehicleType: 'SCOOTER',
        marketRegion: 'IN',
        verificationStatus: 'VERIFIED',
        availability,
      });
    }
    if (url.pathname.endsWith('/active')) return json(route, active);
    if (url.pathname.endsWith('/evidence')) return json(route, uploadedEvidence);
    if (url.pathname.endsWith('/earnings')) {
      return json(route, {
        from: '2026-09-08T00:00:00.000Z',
        to: '2026-10-08T00:00:00.000Z',
        totals: { INR: 0 },
        availableTotals: { INR: 0 },
        earnings: [],
        payouts: [],
      });
    }
    if (url.pathname.endsWith('/offers')) return json(route, []);
    return json(route, {});
  });

  await page.goto('/delivery');
  await expect(page.getByRole('heading', { name: 'Test Kitchen' })).toBeVisible();
  await page.getByLabel('Delivery proof').setInputFiles({
    name: 'dropoff.png',
    mimeType: 'image/png',
    buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  });
  await expect(page.getByText('Evidence uploaded securely.')).toBeVisible();
  await page.getByLabel('Customer delivery code').fill('123456');
  await page.getByLabel('Cash tip received (INR, optional)').fill('3.50');
  await page.getByRole('button', { name: 'Complete delivery' }).click();
  await expect(page.getByRole('heading', { name: 'No active delivery' })).toBeVisible();
  expect(completionPayload).toMatchObject({ deliveryCode: '123456', cashTipMinor: 350 });
  const viewportWidth = page.viewportSize()?.width ?? 1280;
  const renderedWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(renderedWidth).toBeLessThanOrEqual(viewportWidth);
});

test('customer can select a digital tip preset and sees it included in checkout total', async ({
  page,
}) => {
  let previewRequest: Record<string, unknown> | undefined;
  await page.route(`${apiBase}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/carts') {
      return json(route, [
        {
          id: 'cart-id',
          currency: 'INR',
          restaurant: {
            id: 'restaurant-id',
            name: 'Test Kitchen',
            status: 'ACTIVE',
            isAcceptingOrders: true,
          },
          items: [
            {
              id: 'cart-line-id',
              quantity: 1,
              menuItem: {
                id: 'item-id',
                name: 'Rice Bowl',
                description: null,
                priceMinor: 1000,
                currency: 'INR',
                isAvailable: true,
                archivedAt: null,
                optionGroups: [],
              },
              selections: [],
            },
          ],
        },
      ]);
    }
    if (url.pathname === '/api/v1/addresses') {
      return json(route, [
        {
          id: 'address-id',
          label: 'Home',
          line1: '1 Test Street',
          city: 'Pune',
          state: 'MH',
          postalCode: '411001',
          isDefault: true,
        },
      ]);
    }
    if (url.pathname === '/api/v1/checkout/preview') {
      previewRequest = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
      return json(route, {
        currency: 'INR',
        subtotalMinor: 1000,
        discountMinor: 0,
        feesMinor: 0,
        taxMinor: 0,
        tipMinor: previewRequest.tipBasisPoints === 1000 ? 100 : 0,
        totalMinor: previewRequest.tipBasisPoints === 1000 ? 1100 : 1000,
        coupon: null,
        charges: [
          {
            type: 'COURIER_TIP',
            amountMinor: previewRequest.tipBasisPoints === 1000 ? 100 : 0,
            ruleId: null,
            ruleVersion: null,
          },
        ],
      });
    }
    return json(route, {});
  });

  await page.goto('/cart');
  await expect(page.getByRole('heading', { name: 'Cart and checkout preview' })).toBeVisible();
  await page.getByRole('radio', { name: '10%' }).check();
  await page.getByRole('button', { name: 'Recalculate total' }).click();
  await expect(page.getByText('Courier tip', { exact: true })).toBeVisible();
  await expect(page.getByText('₹11.00')).toBeVisible();
  expect(previewRequest).toMatchObject({ tipBasisPoints: 1000 });
});

test('customer can review a delivered order and create/reply to an order support case', async ({
  page,
}) => {
  const order = {
    id: 'delivered-order-id',
    status: 'DELIVERED',
    totalMinor: 1650,
    currency: 'INR',
    createdAt: '2026-10-01T10:00:00.000Z',
    restaurant: { name: 'Test Kitchen' },
  };
  let reviewCreated = false;
  let reviewPayload: Record<string, unknown> | undefined;
  let caseCreated = false;
  let casePayload: Record<string, unknown> | undefined;
  let customerReply = '';

  await page.route(`${apiBase}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'POST' && url.pathname === '/api/v1/reviews') {
      reviewPayload = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
      reviewCreated = true;
      return json(route, { id: 'review-id', ...reviewPayload, status: 'PENDING' });
    }
    if (request.method() === 'POST' && url.pathname === '/api/v1/support/cases') {
      casePayload = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
      caseCreated = true;
      return json(route, {
        id: 'support-case-id',
        category: 'ORDER',
        priority: 'NORMAL',
        status: 'OPEN',
        subject: casePayload.subject,
        customerOutcome: null,
        createdAt: new Date().toISOString(),
        order: { id: 'delivered-order-id', status: 'DELIVERED' },
        messages: [
          {
            id: 'initial-message',
            body: String(casePayload.message),
            createdAt: new Date().toISOString(),
            author: { name: 'Customer' },
          },
        ],
      });
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/messages')) {
      customerReply = String((JSON.parse(request.postData() ?? '{}') as { body?: string }).body);
      return json(route, { id: 'support-case-id', status: 'OPEN', messages: [] });
    }
    if (url.pathname === '/api/v1/orders') return json(route, [order]);
    if (url.pathname === '/api/v1/reviews/mine') {
      return json(
        route,
        reviewCreated
          ? [
              {
                id: 'review-id',
                orderId: order.id,
                rating: 5,
                title: 'Excellent',
                status: 'PENDING',
                restaurant: { name: 'Test Kitchen' },
              },
            ]
          : [],
      );
    }
    if (url.pathname === '/api/v1/support/cases') {
      return json(
        route,
        caseCreated
          ? [
              {
                id: 'support-case-id',
                category: 'ORDER',
                priority: 'NORMAL',
                status: 'OPEN',
                subject: 'Missing side dish',
                customerOutcome: null,
                createdAt: new Date().toISOString(),
                order: { id: order.id, status: 'DELIVERED' },
                messages: customerReply
                  ? [
                      {
                        id: 'customer-reply',
                        body: customerReply,
                        createdAt: new Date().toISOString(),
                        author: { name: 'Customer' },
                      },
                    ]
                  : [],
              },
            ]
          : [],
      );
    }
    return json(route, {});
  });

  await page.goto('/support');
  await expect(page.getByRole('heading', { name: 'Reviews & support' })).toBeVisible();
  await page.getByLabel('Review title').fill('Excellent meal');
  await page.getByLabel('Your review').fill('The meal arrived promptly and tasted wonderful.');
  await page.getByRole('button', { name: 'Submit review' }).click();
  await expect(page.getByText('Review submitted for moderation.')).toBeVisible();
  expect(reviewPayload).toMatchObject({ orderId: order.id, rating: 5 });

  await page.getByLabel('Related order').selectOption(order.id);
  await page.getByLabel('Subject').fill('Missing side dish');
  await page
    .getByLabel('Message', { exact: true })
    .fill('My order was missing the side dish listed on the receipt.');
  await page.getByRole('button', { name: 'Create case' }).click();
  await expect(page.getByText('Support case created.')).toBeVisible();
  expect(casePayload).toMatchObject({ category: 'ORDER', orderId: order.id });
  await page.getByLabel('Reply').fill('I can share a photo of the delivery bag.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  expect(customerReply).toBe('I can share a photo of the delivery bag.');
});

test('moderator can publish a review and an assigned agent can resolve a case', async ({
  page,
}) => {
  let reviewStatus = 'PENDING';
  let caseAssigned = false;
  let caseStatus = 'OPEN';
  let internalNoteAdded = false;
  let caseResolved = false;
  const agentCase = () => ({
    id: 'support-case-id',
    category: 'PAYMENT',
    priority: 'HIGH',
    status: caseStatus,
    subject: 'Duplicate payment',
    assignedToUserId: caseAssigned ? 'agent-id' : null,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: new Date().toISOString(),
    orderId: 'order-id',
    user: { id: 'customer-id', name: 'Test Customer', email: 'customer@example.test' },
    customerOutcome: caseResolved
      ? 'We verified one duplicate charge and initiated the refund.'
      : null,
    resolutionSummary: caseResolved ? 'Duplicate charge confirmed.' : null,
    order: {
      id: 'order-id',
      status: 'DELIVERED',
      totalMinor: 2500,
      currency: 'INR',
      createdAt: '2026-10-01T10:00:00.000Z',
    },
    messages: [
      {
        id: 'customer-message',
        body: 'I see a duplicate charge.',
        isInternal: false,
        createdAt: '2026-10-01T10:05:00.000Z',
        author: { id: 'customer-id', name: 'Test Customer' },
      },
      ...(internalNoteAdded
        ? [
            {
              id: 'internal-note',
              body: 'Checked payment ledger.',
              isInternal: true,
              createdAt: '2026-10-01T10:10:00.000Z',
              author: { id: 'agent-id', name: 'Support Agent' },
            },
          ]
        : []),
    ],
  });

  await page.route(`${apiBase}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'PATCH' && url.pathname.endsWith('/moderation')) {
      reviewStatus = 'PUBLISHED';
      return json(route, { id: 'review-id', status: reviewStatus });
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/claim')) {
      caseAssigned = true;
      caseStatus = 'IN_PROGRESS';
      return json(route, agentCase());
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/messages')) {
      const payload = JSON.parse(request.postData() ?? '{}') as { isInternal?: boolean };
      internalNoteAdded = Boolean(payload.isInternal);
      return json(route, agentCase());
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/resolve')) {
      caseResolved = true;
      caseStatus = 'RESOLVED';
      return json(route, agentCase());
    }
    if (url.pathname === '/api/v1/admin/reviews') {
      return json(
        route,
        url.searchParams.get('status') === reviewStatus
          ? [
              {
                id: 'review-id',
                orderId: 'order-id',
                rating: 2,
                title: 'Late delivery',
                body: 'The order arrived later than expected.',
                status: reviewStatus,
                createdAt: '2026-10-01T10:00:00.000Z',
                user: { id: 'customer-id', name: 'Test Customer', email: 'customer@example.test' },
                restaurant: { id: 'restaurant-id', name: 'Test Kitchen' },
                reports: [
                  {
                    id: 'report-id',
                    reason: 'Contains personal information',
                    createdAt: '2026-10-01T11:00:00.000Z',
                  },
                ],
              },
            ]
          : [],
      );
    }
    if (url.pathname === '/api/v1/support/agent/cases') {
      return json(route, caseResolved ? [] : [agentCase()]);
    }
    if (url.pathname === '/api/v1/support/agent/cases/support-case-id') {
      return json(route, agentCase());
    }
    return json(route, {});
  });

  await page.goto('/admin/reviews-support');
  await expect(page.getByRole('heading', { name: 'Review moderation' })).toBeVisible();
  await expect(page.getByText('Contains personal information')).toBeVisible();
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('No reviews in this queue.')).toBeVisible();

  await page.getByRole('button', { name: 'Claim case' }).click();
  await expect(page.getByText('customer@example.test')).toBeVisible();
  await page.getByLabel('Reply or internal note').fill('Checked payment ledger.');
  await page.getByLabel('Internal note, hidden from customer').check();
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Support Agent · Internal note', { exact: true })).toBeVisible();
  await page.getByLabel('Internal resolution summary').fill('Duplicate charge confirmed.');
  await page
    .getByLabel('Customer-visible outcome')
    .fill('We verified one duplicate charge and initiated the refund.');
  await page.getByRole('button', { name: 'Resolve and notify' }).click();
  await expect(page.getByText('Case resolved and the customer outcome was sent.')).toBeVisible();
  await expect(page.locator('.support-case-detail .support-status')).toHaveText('resolved');
  const viewportWidth = page.viewportSize()?.width ?? 1280;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    viewportWidth,
  );
});

test('customer can report a published restaurant review for moderation', async ({ page }) => {
  let reportPayload: Record<string, unknown> | undefined;
  await page.route(`${apiBase}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'POST' && url.pathname === '/api/v1/reviews/review-id/reports') {
      reportPayload = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
      return json(route, { id: 'report-id', reviewId: 'review-id' });
    }
    if (url.pathname === '/api/v1/restaurants/restaurant-id/menu') {
      return json(route, {
        id: 'restaurant-id',
        name: 'Test Kitchen',
        description: null,
        city: 'Pune',
        state: 'MH',
        isAcceptingOrders: false,
        categories: [],
        items: [],
      });
    }
    if (url.pathname === '/api/v1/restaurants/restaurant-id/reviews') {
      return json(route, [
        {
          id: 'review-id',
          rating: 1,
          title: 'Personal details included',
          body: 'This review appears to contain someone else’s personal information.',
          createdAt: '2026-10-01T10:00:00.000Z',
        },
      ]);
    }
    return json(route, {});
  });

  await page.goto('/restaurants/restaurant-id');
  await expect(page.getByRole('heading', { name: 'Customer reviews' })).toBeVisible();
  await page.getByRole('button', { name: 'Report' }).click();
  await page
    .getByLabel('Why should this review be checked?')
    .fill('This review contains personal information that should not be public.');
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByText('Report sent to our moderation team.')).toBeVisible();
  expect(reportPayload).toMatchObject({
    reason: 'This review contains personal information that should not be public.',
  });
});
